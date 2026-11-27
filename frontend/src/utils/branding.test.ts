import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyBrandingToMessages,
  brandDisplayName,
  getBrandingLinks,
  getWebsiteUrl,
  resolveAppTitle,
  resolveBrandName,
  transformBrandString,
} from './branding.ts'

/** Point window.__BRANDING__ at a config for the duration of `fn`. */
function withBranding(config: Record<string, string>, fn: () => void): void {
  const g = globalThis as { window?: unknown }
  const prev = g.window
  g.window = { __BRANDING__: config }
  try {
    fn()
  } finally {
    g.window = prev
  }
}

test('empty config leaves everything untouched', () => {
  withBranding({}, () => {
    assert.equal(resolveBrandName('zh-CN'), '')
    assert.equal(resolveBrandName('en-US'), '')
    assert.equal(brandDisplayName('zh-CN'), 'WeKnora')
    assert.equal(resolveAppTitle(), '')
    assert.deepEqual(getBrandingLinks(), { website: '', logo: '', sidebarLogo: '' })
    assert.equal(getWebsiteUrl(), 'https://weknora.weixin.qq.com')
    assert.equal(transformBrandString('欢迎使用 WeKnora', 'zh-CN'), '欢迎使用 WeKnora')
  })
})

test('APP_NAME wins over per-locale variants', () => {
  withBranding(
    { APP_NAME: '统一名', APP_NAME_ZH: '中文名', APP_NAME_EN: 'English Name' },
    () => {
      assert.equal(resolveBrandName('zh-CN'), '统一名')
      assert.equal(resolveBrandName('en-US'), '统一名')
      assert.equal(resolveBrandName('ja-JP'), '统一名')
    },
  )
})

test('locale routing uses APP_NAME_ZH / APP_NAME_EN', () => {
  withBranding({ APP_NAME_ZH: '中文名', APP_NAME_EN: 'English Name' }, () => {
    assert.equal(resolveBrandName('zh-CN'), '中文名')
    assert.equal(resolveBrandName('zh-TW'), '中文名')
    assert.equal(resolveBrandName('en-US'), 'English Name')
    assert.equal(resolveBrandName('ru-RU'), 'English Name')
    assert.equal(resolveBrandName('ja-JP'), 'English Name')
  })
})

test('nested bundle strings are rewritten, keys and originals untouched', () => {
  const bundle = {
    common: {
      weknoraTemplateTitle: '欢迎使用 WeKnora',
      nested: { hello: ['Hi，我是 WeKnora', 'plain'] },
    },
    keep: 42,
  }
  const snapshot = JSON.stringify(bundle)
  withBranding({ APP_NAME_ZH: '纪法知识库' }, () => {
    const out = applyBrandingToMessages(bundle, 'zh-CN')
    assert.equal(out.common.weknoraTemplateTitle, '欢迎使用纪法知识库')
    assert.deepEqual(out.common.nested.hello, ['Hi，我是纪法知识库', 'plain'])
    assert.equal(out.keep, 42)
    // Object keys are internal identifiers and must survive.
    assert.ok('weknoraTemplateTitle' in out.common)
    // Input bundle is never mutated.
    assert.equal(JSON.stringify(bundle), snapshot)
  })
})

test('protected tokens survive the rewrite', () => {
  withBranding({ APP_NAME_ZH: '纪法知识库' }, () => {
    const input =
      '配置 WeKnora Cloud 模型、使用 WeKnoraCloud 服务、运行 WeKnora CLI、安装 WeKnora Skill、校验 X-WeKnora-Signature，然后使用 WeKnora。'
    const out = transformBrandString(input, 'zh-CN')
    assert.ok(out.includes('WeKnora Cloud'))
    assert.ok(out.includes('WeKnoraCloud'))
    assert.ok(out.includes('WeKnora CLI'))
    assert.ok(out.includes('WeKnora Skill'))
    assert.ok(out.includes('X-WeKnora-Signature'))
    assert.ok(out.endsWith('，然后使用纪法知识库。'))
    assert.equal(out.match(/WeKnora/g)?.length, 5)
  })
})

test('CJK brand name drops surrounding latin spaces in Chinese text', () => {
  withBranding({ APP_NAME_ZH: '中国中煤纪法知识库' }, () => {
    assert.equal(
      transformBrandString('Hi，我是 WeKnora，让你的知识触手可及', 'zh-CN'),
      'Hi，我是中国中煤纪法知识库，让你的知识触手可及',
    )
    assert.equal(
      transformBrandString('认识 WeKnora 助手', 'zh-CN'),
      '认识中国中煤纪法知识库助手',
    )
  })
})

test('latin brand name keeps CJK-latin spacing', () => {
  withBranding({ APP_NAME_EN: 'Discipline & Law KB' }, () => {
    assert.equal(
      transformBrandString('Welcome to WeKnora assistant', 'en-US'),
      'Welcome to Discipline & Law KB assistant',
    )
    assert.equal(
      transformBrandString('欢迎使用 WeKnora 助手', 'en-US'),
      '欢迎使用 Discipline & Law KB 助手',
    )
  })
})

test('transform is idempotent', () => {
  withBranding({ APP_NAME_ZH: '纪法知识库' }, () => {
    const once = transformBrandString('WeKnora Cloud 与 WeKnora 助手', 'zh-CN')
    const twice = transformBrandString(once, 'zh-CN')
    assert.equal(once, twice)
  })
})

test('strings without the brand word are returned as-is', () => {
  withBranding({ APP_NAME_ZH: '纪法知识库' }, () => {
    assert.equal(transformBrandString('普通文本', 'zh-CN'), '普通文本')
    assert.equal(transformBrandString('', 'zh-CN'), '')
  })
})

test('link overrides are returned verbatim', () => {
  withBranding(
    {
      WEBSITE_URL: 'https://www.example.com',
      LOGO_URL: '/logo-custom.png',
      SIDEBAR_LOGO_URL: '/sidebar-logo-custom.png',
    },
    () => {
      const links = getBrandingLinks()
      assert.equal(links.website, 'https://www.example.com')
      assert.equal(links.logo, '/logo-custom.png')
      assert.equal(links.sidebarLogo, '/sidebar-logo-custom.png')
      assert.equal(getWebsiteUrl(), 'https://www.example.com')
    },
  )
})

test('title resolution prefers APP_TITLE then APP_NAME', () => {
  withBranding({ APP_TITLE: '站点标题', APP_NAME: '品牌名' }, () => {
    assert.equal(resolveAppTitle(), '站点标题')
  })
  withBranding({ APP_NAME: '品牌名' }, () => {
    assert.equal(resolveAppTitle(), '品牌名')
  })
  withBranding({ APP_NAME_ZH: '中文名' }, () => {
    assert.equal(resolveAppTitle(), '')
  })
})

test('values are trimmed before use', () => {
  withBranding({ APP_NAME_ZH: '  纪法知识库  ' }, () => {
    assert.equal(resolveBrandName('zh-CN'), '纪法知识库')
    assert.equal(transformBrandString('使用 WeKnora', 'zh-CN'), '使用纪法知识库')
  })
})
