// 自定义底部导航栏 - 按角色显示不同菜单
// 支持站内未读订单红点

const TABS = {
  admin: [
    { key: 'dashboard', label: '工作台', icon: '\ud83d\udcca', route: '/pages/admin/dashboard/index' },
    { key: 'stores',    label: '管理',   icon: '\ud83d\udc65', route: '/pages/admin/stores/index' },
    { key: 'goods',     label: '货品',   icon: '\ud83d\udce6', route: '/pages/admin/goods/index' },
    { key: 'orders',    label: '订单',   icon: '\ud83d\udcdd', route: '/pages/admin/orders/index' },
    { key: 'profile',   label: '我的',   icon: '\ud83d\udc64', route: '/pages/admin/profile/index' }
  ],
  manager: [
    { key: 'dashboard',  label: '工作台', icon: '\ud83d\udcca', route: '/pages/manager/dashboard/index' },
    { key: 'purchase',   label: '采购',   icon: '\ud83d\udce5', route: '/pages/manager/purchase/index' },
    { key: 'cart',       label: '购物车', icon: '\ud83d\uded2', route: '/pages/manager/cart/index' },
    { key: 'orders',     label: '订单',   icon: '\ud83d\udcdd', route: '/pages/manager/orders/index' },
    { key: 'profile',    label: '我的',   icon: '\ud83d\udc64', route: '/pages/manager/profile/index' }
  ],
  supplier: [
    { key: 'dashboard', label: '工作台', icon: '\ud83d\udcca', route: '/pages/supplier/dashboard/index' },
    { key: 'orders',    label: '订单',   icon: '\ud83d\udcdd', route: '/pages/supplier/orders/index' },
    { key: 'reports',   label: '报表',   icon: '\ud83d\udcca', route: '/pages/supplier/reports/index' },
    { key: 'profile',   label: '我的',   icon: '\ud83d\udc64', route: '/pages/supplier/profile/index' }
  ]
}

Component({
  properties: {
    current: { type: String, value: '' }
  },

  data: {
    tabs: [],
    role: '',
    unreadCount: 0
  },

  lifetimes: {
    attached() {
      this._initTabs()
    }
  },

  pageLifetimes: {
    show() {
      this._refreshUnread()
    }
  },

  methods: {
    _initTabs() {
      const app = getApp()
      const role = app.globalData.user ? app.globalData.user.role : 'manager'
      const tabs = TABS[role] || TABS.manager
      this.setData({ tabs, role })
    },

    _refreshUnread() {
      const app = getApp()
      const user = app.globalData.user
      if (!user) return
      // 5 秒防抖，避免频繁切换 tab 时反复查询云函数
      const now = Date.now()
      if (this._lastUnreadRefresh && now - this._lastUnreadRefresh < 5000) {
        this.setData({ unreadCount: app.globalData.orderUnreadCount || 0 })
        return
      }
      this._lastUnreadRefresh = now
      // 异步刷新，不阻塞渲染
      app.refreshOrderUnread().then(() => {
        this.setData({ unreadCount: app.globalData.orderUnreadCount || 0 })
      })
    },

    switchTab(e) {
      const route = e.currentTarget.dataset.route
      const currentPages = getCurrentPages()
      const currentRoute = currentPages.length > 0 ? '/' + currentPages[currentPages.length - 1].route : ''

      if (currentRoute === route) return

      wx.reLaunch({ url: route })
    }
  }
})
