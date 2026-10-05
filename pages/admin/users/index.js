const cloud = require('../../../utils/cloud.js')

Page({
  data: {
    allUsers: [],
    users: [],
    keyword: '',
    filterRole: '',
    roleLabels: { admin: '管理员', manager: '店长', supplier: '供货商' },

    showModal: false,
    modalTitle: '新增用户',
    editingId: '',

    formName: '',
    formPhone: '',
    formPassword: '',
    formRole: 'manager',
    formSupplierName: '',
    formStoreId: '',
    formStatus: 'active',

    storeList: [],
    storeIdx: 0
  },

  async onShow() {
    await this.loadUsers()
  },

  async loadUsers() {
    wx.showLoading({ title: '加载中...' })
    try {
      const data = await cloud.getAdminData()
      wx.hideLoading()
      let allUsers = data.users

      const suppliers = data.suppliers || []
      const supMap = {}
      suppliers.forEach(s => { supMap[s._id] = s.name })
      allUsers = allUsers.map(u => {
        if (u.role === 'supplier' && u.supplierId) {
          u.supplierName = supMap[u.supplierId] || ''
        }
        return u
      })
      allUsers.sort((a, b) => new Date(b.createTime) - new Date(a.createTime))

      this.setData({
        allUsers,
        storeList: data.stores.map(s => s.name)
      })
      this.filterUsers()
    } catch (e) {
      wx.hideLoading()
      console.error('loadUsers error', e)
    }
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.filterUsers()
  },

  filterUsers() {
    let list = this.data.allUsers
    if (this.data.filterRole) {
      list = list.filter(u => u.role === this.data.filterRole)
    }
    if (this.data.keyword) {
      const kw = this.data.keyword.toLowerCase()
      list = list.filter(u =>
        (u.name && u.name.toLowerCase().includes(kw)) ||
        (u.phone && u.phone.toLowerCase().includes(kw)) ||
        (u.supplierName && u.supplierName.toLowerCase().includes(kw))
      )
    }
    this.setData({ users: list })
  },

  filterByRole(e) {
    this.setData({ filterRole: e.currentTarget.dataset.role || '' }, () => this.filterUsers())
  },

  showAddModal() {
    const stores = cloud.list('stores')
    this.setData({
      showModal: true,
      modalTitle: '新增用户',
      editingId: '',
      formName: '',
      formPhone: '',
      formPassword: '',
      formRole: 'manager',
      formSupplierName: '',
      formStoreId: stores.length > 0 ? stores[0]._id : '',
      formStatus: 'active',
      storeList: stores.map(s => s.name),
      storeIdx: 0
    })
  },

  showEditModal(e) {
    const user = cloud.getById('users', e.currentTarget.dataset.id)
    if (!user) return
    const stores = cloud.list('stores')
    const storeIdx = stores.findIndex(s => s._id === user.storeId)

    let supplierName = ''
    if (user.role === 'supplier' && user.supplierId) {
      const sup = cloud.getById('suppliers', user.supplierId)
      supplierName = sup ? sup.name : ''
    }

    this.setData({
      showModal: true,
      modalTitle: '编辑用户',
      editingId: user._id,
      formName: user.name,
      formPhone: user.phone || '',
      formPassword: '',
      formRole: user.role,
      formSupplierName: supplierName,
      formStoreId: user.storeId || (stores.length > 0 ? stores[0]._id : ''),
      formStatus: user.status || 'active',
      storeList: stores.map(s => s.name),
      storeIdx: storeIdx >= 0 ? storeIdx : 0
    })
  },

  closeModal() {
    this.setData({ showModal: false })
  },

  onRoleChange(e) {
    const roles = ['admin', 'manager', 'supplier']
    this.setData({ formRole: roles[e.detail.value] })
  },

  onFormName(e) { this.setData({ formName: e.detail.value }) },
  onFormPhone(e) { this.setData({ formPhone: e.detail.value }) },
  onFormPassword(e) { this.setData({ formPassword: e.detail.value }) },
  onSupplierName(e) { this.setData({ formSupplierName: e.detail.value }) },

  onStoreChange(e) {
    const idx = parseInt(e.detail.value)
    const stores = cloud.list('stores')
    this.setData({ storeIdx: idx, formStoreId: stores[idx] ? stores[idx]._id : '' })
  },

  onStatusChange(e) {
    this.setData({ formStatus: e.detail.value })
  },

  async submitUser() {
    const { editingId, formName, formPhone, formPassword, formRole, formSupplierName, formStoreId, formStatus } = this.data
    try {
    if (editingId) {
      if (!formPhone.trim()) {
        wx.showToast({ title: '请输入手机号', icon: 'none' })
        return
      }
      wx.showLoading({ title: '保存中...' })
      var supplierId = ''
      if (formRole === 'supplier' && formSupplierName.trim()) {
        supplierId = await cloud.resolveSupplier(formSupplierName.trim())
      }
      const updateData = {
        name: formName.trim(),
        phone: formPhone.trim(),
        role: formRole,
        storeId: formRole === 'manager' ? formStoreId : '',
        supplierId: formRole === 'supplier' ? supplierId : '',
        status: formStatus
      }
      if (formPassword.trim()) {
        updateData.password = formPassword.trim()
      }
      await cloud.updateUser(editingId, updateData)
      wx.hideLoading()
      wx.showToast({ title: '更新成功', icon: 'success' })
    } else {
      if (!formPhone.trim()) {
        wx.showToast({ title: '请输入手机号', icon: 'none' })
        return
      }
      if (!formPassword.trim()) {
        wx.showToast({ title: '请输入密码', icon: 'none' })
        return
      }
      if (formRole === 'supplier' && !formSupplierName.trim()) {
        wx.showToast({ title: '请输入供货商名称', icon: 'none' })
        return
      }
      wx.showLoading({ title: '添加中...' })
      var newSupplierId = ''
      if (formRole === 'supplier') {
        newSupplierId = await cloud.resolveSupplier(formSupplierName.trim())
      }
      var roleNames = { admin: '管理员', manager: '店长', supplier: '供货商' }
      await cloud.addUser({
        name: formName.trim() || roleNames[formRole],
        phone: formPhone.trim(),
        password: formPassword.trim(),
        role: formRole,
        storeId: formRole === 'manager' ? formStoreId : '',
        supplierId: newSupplierId
      })
      wx.hideLoading()
      wx.showToast({ title: '添加成功', icon: 'success' })
    }
    this.closeModal()
    await this.loadUsers()
    } catch (e) {
      wx.hideLoading()
      wx.showModal({ title: '操作失败', content: String(e.message || e).slice(0, 80), showCancel: false })
    }
  },

  toggleUserStatus(e) {
    const user = cloud.getById('users', e.currentTarget.dataset.id)
    if (!user) return
    const newStatus = user.status === 'active' ? 'disabled' : 'active'
    const actionText = newStatus === 'active' ? '启用' : '禁用'

    wx.showModal({
      title: '确认操作',
      content: '确认' + actionText + '用户「' + user.name + '」？',
      success: async res => {
        if (res.confirm) {
          await cloud.updateUser(user._id, { status: newStatus })
          wx.showToast({ title: '操作成功', icon: 'success' })
          await this.loadUsers()
        }
      }
    })
  },

  deleteUser(e) {
    const user = cloud.getById('users', e.currentTarget.dataset.id)
    if (!user) return

    wx.showModal({
      title: '⚠️ 删除用户',
      content: '确认删除用户「' + user.name + '」？删除后该账号将被停用，历史订单数据不受影响。',
      success: async res => {
        if (res.confirm) {
          await cloud.deleteUser(user._id)
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadUsers()
        }
      }
    })
  },

  approve(e) { this.actionUser(e.currentTarget.dataset.id, 'approve') },
  reject(e) { this.actionUser(e.currentTarget.dataset.id, 'reject') },

  actionUser(userId, action) {
    wx.showModal({
      title: '确认操作',
      content: action === 'approve' ? '确认审核通过该用户？' : '确认拒绝该用户的申请？',
      success: async res => {
        if (res.confirm) {
          if (action === 'approve') await cloud.approveUser(userId)
          else await cloud.rejectUser(userId)
          wx.showToast({ title: '操作成功', icon: 'success' })
          await this.loadUsers()
        }
      }
    })
  }
})
