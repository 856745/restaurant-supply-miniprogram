const cloud = require('../../utils/cloud.js')
const { ROLES } = require('../../utils/config.js')

Page({
  data: {
    selectedRole: '',
    name: '',
    phone: '',
    password: '',
    confirmPassword: '',
    showForm: false,
    isRegister: false,
    isCloud: cloud.USE_CLOUD,
    roles: [
      { id: 'admin',    name: '管理员', desc: '系统管理 · 审核账号 · 全局报表', color: '#4f46e5', bg: '#eef2ff' },
      { id: 'manager',  name: '店长',   desc: '采购下单 · 供应商管理 · 订单跟踪', color: '#0f766e', bg: '#f0fdfa' },
      { id: 'supplier', name: '供货商',  desc: '订单接单 · 发货管理 · 销售报表', color: '#ea580c', bg: '#fff7ed' }
    ]
  },

  onLoad() {
    // 云端模式：由 app.js 的 checkLogin() 负责校验 session 后跳转
    // Mock 模式：直接检查本地用户，存在则跳转
    if (!cloud.USE_CLOUD) {
      const user = wx.getStorageSync('syx_user')
      if (user && user.status === 'active') {
        const app = getApp()
        app.setUser(user)
        app.goHome()
      }
    }
  },

  selectRole(e) {
    const role = e.currentTarget.dataset.role
    this.setData({ selectedRole: role, showForm: true, isRegister: false })
  },

  // 登录（mock 和 cloud 通用）
  async doLoginAction() {
    const role = this.data.selectedRole
    const phone = this.data.phone.trim()
    const password = this.data.password
    if (!phone) return wx.showToast({ title: '请输入手机号', icon: 'none' })
    if (!password) return wx.showToast({ title: '请输入密码', icon: 'none' })

    wx.showLoading({ title: '登录中...' })
    try {
      const user = await cloud.loginAs(role, phone, password)
      wx.hideLoading()
      if (user) {
        this.doLogin(user)
      } else {
        wx.showModal({
          title: '登录失败',
          content: '手机号或密码错误。如果是新用户，请点击注册。',
          confirmText: '去注册',
          cancelText: '重新输入',
          success: (res) => {
            if (res.confirm) {
              this.setData({ isRegister: true, password: '', confirmPassword: '' })
            }
          }
        })
      }
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: err.message || '网络错误，请检查云开发配置', icon: 'none', duration: 3000 })
    }
  },

  // 注册
  async doRegisterAction() {
    const { selectedRole, phone, name, password, confirmPassword } = this.data
    if (!phone.trim()) return wx.showToast({ title: '请输入手机号', icon: 'none' })
    if (!password) return wx.showToast({ title: '请输入密码', icon: 'none' })
    if (password !== confirmPassword) return wx.showToast({ title: '两次密码不一致', icon: 'none' })

    wx.showLoading({ title: '注册中...' })
    try {
      const user = await cloud.register(selectedRole, name.trim(), phone.trim(), password)
      wx.hideLoading()
      if (user) {
        // 注册成功，需管理员审核
        wx.showModal({
          title: '注册成功',
          content: '账号已提交，请等待管理员审核通过后重新登录。',
          showCancel: false,
          success: () => {
            this.setData({ isRegister: false, name: '', password: '', confirmPassword: '' })
          }
        })
      } else {
        wx.showModal({
          title: '注册失败',
          content: '该手机号已在此角色下注册，请返回登录或更换手机号。',
          showCancel: false
        })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('注册错误:', err)
      wx.showToast({ title: (err && err.message) ? err.message.slice(0, 40) : '网络错误，请重试', icon: 'none', duration: 3000 })
    }
  },

  // 提交按钮
  submitForm() {
    if (this.data.isRegister) {
      this.doRegisterAction()
    } else {
      this.doLoginAction()
    }
  },

  // 切换登录/注册
  switchMode() {
    this.setData({
      isRegister: !this.data.isRegister,
      password: '',
      confirmPassword: ''
    })
  },

  doLogin(user) {
    wx.setStorageSync('syx_user', user)
    const app = getApp()
    app.setUser(user)
    wx.showToast({ title: '登录成功', icon: 'success', duration: 800 })
    setTimeout(() => app.goHome(), 900)
  },
  onNameInput(e) { this.setData({ name: e.detail.value }) },
  onPhoneInput(e) { this.setData({ phone: e.detail.value }) },
  onPasswordInput(e) { this.setData({ password: e.detail.value }) },
  onConfirmPasswordInput(e) { this.setData({ confirmPassword: e.detail.value }) },

  back() {
    this.setData({
      selectedRole: '',
      showForm: false,
      isRegister: false,
      name: '',
      phone: '',
      password: '',
      confirmPassword: ''
    })
  }
})
