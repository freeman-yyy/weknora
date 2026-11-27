/**
 * 品牌运行时配置（改完保存 → 刷新页面即生效，无需重启或重建镜像）。
 *
 * 本地开发：npm run dev 后直接编辑本文件，刷新 http://localhost:5173 即生效。
 * Docker 部署：docker-compose.yml 将 deploy/branding.js 挂载到容器内
 * /usr/share/nginx/html/branding.js（只读），编辑宿主机上的 deploy/branding.js
 * 保存后刷新浏览器即生效（nginx 对该文件返回 no-cache，不受浏览器缓存影响）。
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
  APP_NAME: '中国中煤纪法知识库',
  APP_NAME_ZH: '中国中煤纪法知识库',
  APP_NAME_EN: 'China Coal Discipline & Law Knowledge Base',
  APP_TITLE: '中国中煤纪法知识库',
  WEBSITE_URL: 'http://localhost:5173',
  LOGO_URL: '/zmjfzsk-logo.svg',
  SIDEBAR_LOGO_URL: '/jfzsk-logo.svg',

  // 示例：替换为自有品牌（去掉注释并填写即可）
  // APP_NAME_ZH: '中国中煤纪法知识库',
  // APP_NAME_EN: 'China Coal Discipline & Law Knowledge Base',
  // APP_TITLE: '中国中煤纪法知识库',
  // LOGO_URL: '/logo-custom.png',
};
