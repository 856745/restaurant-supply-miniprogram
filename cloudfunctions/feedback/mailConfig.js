// ==================== 意见反馈邮件通知配置 ====================
// 反馈会先写入云数据库（feedbacks 集合），邮件通知是可选的增强。
// 填好下方配置后，重新「上传并部署」 feedback 云函数即可启用邮件。
// 未启用时，反馈仍会正常保存，管理员可在小程序「我的 → 查看反馈」中查看。
//
// 也可以不修改本文件，改用云函数环境变量注入：
//   FEEDBACK_MAIL_TO / SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS

module.exports = {
  // 收件人邮箱（反馈发送目标，可多个）。请替换为你自己的邮箱。
  to: process.env.FEEDBACK_MAIL_TO ? process.env.FEEDBACK_MAIL_TO.split(',') : [],

  // 是否启用邮件通知：填好 smtp 后改为 true
  enabled: false,

  // 发件邮箱 + SMTP 授权码
  //   QQ 邮箱：host=smtp.qq.com   port=465
  //   163 邮箱：host=smtp.163.com port=465
  // 授权码获取：网页版邮箱 → 设置 → 账号 → 开启 POP3/SMTP 服务 → 生成授权码
  // 注意：pass 填「授权码」，不是邮箱登录密码；不要将真实授权码提交到仓库
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,      // 465 端口使用 SSL
    user: process.env.SMTP_USER || '',   // 发件邮箱地址（与 host 域名对应）
    pass: process.env.SMTP_PASS || '',   // SMTP 授权码
    from: process.env.SMTP_FROM || ''    // 可选：发件人地址，默认同 user
  }
}

