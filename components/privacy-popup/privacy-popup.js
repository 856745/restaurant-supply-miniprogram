// 隐私政策弹窗组件：展示摘要 + 引用链接（点击才跳转）+ 同意/不同意
Component({
  properties: {
    show: { type: Boolean, value: false }
  },

  methods: {
    // 点击链接才跳转到微信官方隐私政策页面（不再自动跳转）
    onViewContract() {
      if (wx.openPrivacyContract) {
        wx.openPrivacyContract({})
      }
    },

    // 同意：触发隐私授权流程并关闭弹窗
    onAgree() {
      if (wx.requirePrivacyAuthorize) {
        wx.requirePrivacyAuthorize({ success: () => {}, fail: () => {} })
      }
      this.triggerEvent('close')
    },

    // 不同意：关闭弹窗
    onDisagree() {
      this.triggerEvent('close')
    },

    // 点遮罩关闭
    onClose() {
      this.triggerEvent('close')
    }
  }
})
