/**
 * 品牌运行时配置（部署侧，docker-compose 挂载到 frontend 容器内）。
 *
 * 编辑本文件并保存后，用户刷新浏览器即见新配置——无需重启容器、
 * 无需重建镜像（nginx 对 /branding.js 返回 no-cache，不受浏览器缓存影响）。
 *
 * 规则：
 * - 所有字段留空 = 保持内置 WeKnora 名称与链接，行为不变。
 * - APP_NAME：统一品牌名，对全部语言生效（优先级最高）。
 * - APP_NAME_ZH / APP_NAME_EN：分别覆盖中文界面 / 其他语言界面的品牌名。
 * - APP_TITLE：浏览器标签页标题；留空时若设置了 APP_NAME 则用 APP_NAME。
 * - LOGO_URL：覆盖登录页 Logo 图片地址。
 * - SIDEBAR_LOGO_URL：覆盖平台侧边栏 Logo 图片地址（与登录页相互独立）。
 * - WEBSITE_URL 为保留键位：当前界面无官网展示位。
 *   文档链接（docsUrl）与 GitHub 链接已改为内置常量，不再支持配置。
 *
 * 界面文案中的 WeKnora 品牌词会在运行时被替换为上面的品牌名
 * （WeKnora Cloud / WeKnora CLI / WeKnora Skill 等产品专名与
 * X-WeKnora-Signature 等技术标识不受影响）。
 */
window.__BRANDING__ = {
  APP_NAME: '',
  APP_NAME_ZH: '',
  APP_NAME_EN: '',
  APP_TITLE: '',
  WEBSITE_URL: '',
  LOGO_URL: '',
  SIDEBAR_LOGO_URL: '',

  // 示例：替换为自有品牌（去掉注释并填写即可）
  // APP_NAME_ZH: '中国中煤纪法知识库',
  // APP_NAME_EN: 'China Coal Discipline & Law Knowledge Base',
  // APP_TITLE: '中国中煤纪法知识库',
  // LOGO_URL: '/logo-custom.png',
};
