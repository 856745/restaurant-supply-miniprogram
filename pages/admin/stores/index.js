const cloud = require('../../../utils/cloud.js')
const excel = require('../../../utils/excel.js')

Page({
  data: {
    tab: 'stores', // stores | suppliers
    allStores: [],
    allSuppliers: [],
    stores: [],
    suppliers: [],
    keyword: '',
    showModal: false, modalTitle: '', form: {},
    // 供货商批量导入
    showSupplierImport: false,
    showSupplierPasteFallback: false,
    supplierPasteText: '',
    supplierImportPreview: [],
    supplierImportSelectedCount: 0,
    supplierImportAllSelected: false,
    supplierImportProgress: '',
    supplierImporting: false
  },

  async onShow() { await this.loadData() },

  async loadData() {
    try {
      wx.showLoading({ title: '加载中...' })
      const data = await cloud.getAdminData()
      this.setData({ allStores: data.stores, allSuppliers: data.suppliers })
      this.filterList()
    } catch (e) {
      console.error('加载数据失败', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.filterList()
  },

  filterList() {
    const kw = this.data.keyword.toLowerCase()
    let stores = this.data.allStores
    let suppliers = this.data.allSuppliers
    if (kw) {
      stores = stores.filter(s =>
        (s.name && s.name.toLowerCase().includes(kw)) ||
        (s.address && s.address.toLowerCase().includes(kw)) ||
        (s.phone && s.phone.toLowerCase().includes(kw))
      )
      suppliers = suppliers.filter(s =>
        (s.name && s.name.toLowerCase().includes(kw)) ||
        (s.contact && s.contact.toLowerCase().includes(kw)) ||
        (s.phone && s.phone.toLowerCase().includes(kw)) ||
        (s.address && s.address.toLowerCase().includes(kw))
      )
    }
    this.setData({ stores, suppliers })
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }) },

  addStore() {
    this.setData({ showModal: true, modalTitle: '新增店铺', form: { name: '', address: '', phone: '' } })
  },
  addSupplier() {
    this.setData({ showModal: true, modalTitle: '新增供货商', form: { name: '', contact: '', phone: '', address: '', categories: [], minOrderAmount: 0, settlementType: 'monthly', couponType: 'none', couponValue: 0 } })
  },

  editStore(e) {
    const item = this.data.stores.find(s => s._id === e.currentTarget.dataset.id)
    this.setData({ showModal: true, modalTitle: '编辑店铺', form: { ...item } })
  },
  editSupplier(e) {
    const item = this.data.suppliers.find(s => s._id === e.currentTarget.dataset.id)
    this.setData({
      showModal: true,
      modalTitle: '编辑供货商',
      form: {
        ...item,
        categories: item.categories || [],
        minOrderAmount: item.minOrderAmount || 0,
        settlementType: item.settlementType || 'monthly',
        couponType: item.couponType || 'none',
        couponValue: item.couponValue || 0,
        visibleStores: item.visibleStores || []
      }
    })
  },

  closeModal() { this.setData({ showModal: false }) },

  onFormChange(e) {
    const { field } = e.currentTarget.dataset
    const form = { ...this.data.form }
    form[field] = e.detail.value
    this.setData({ form })
  },

  // 结算方式 picker
  onSettlementChange(e) {
    const idx = parseInt(e.detail.value)
    const types = ['monthly', 'current', 'prepay']
    const form = { ...this.data.form }
    form.settlementType = types[idx]
    this.setData({ form })
  },

  // 优惠券类型 picker
  onCouponTypeChange(e) {
    const idx = parseInt(e.detail.value)
    const types = ['none', 'fixed', 'percent']
    const form = { ...this.data.form }
    form.couponType = types[idx]
    this.setData({ form })
  },

  // 门店可见性切换
  toggleStoreVisible(e) {
    const storeId = e.currentTarget.dataset.id
    const form = { ...this.data.form }
    var visibleStores = (form.visibleStores || []).slice()
    var idx = visibleStores.indexOf(storeId)
    if (idx > -1) {
      visibleStores.splice(idx, 1)
    } else {
      visibleStores.push(storeId)
    }
    form.visibleStores = visibleStores
    this.setData({ form })
  },

  // 清除门店可见性限制
  clearStoreVisible() {
    const form = { ...this.data.form }
    form.visibleStores = []
    this.setData({ form })
  },

  async save() {
    const { tab, form } = this.data
    if (!form.name) return wx.showToast({ title: '名称不能为空', icon: 'none' })

    wx.showLoading({ title: '保存中...' })
    try {
      if (tab === 'stores') {
        await cloud.saveStore(form)
      } else {
        // 确保数字字段为数值类型
        form.minOrderAmount = Number(form.minOrderAmount) || 0
        form.couponValue = Number(form.couponValue) || 0
        await cloud.saveSupplier(form)
      }
      wx.hideLoading()
      wx.showToast({ title: '保存成功', icon: 'success' })
      this.setData({ showModal: false })
      await this.loadData()
    } catch (e) {
      wx.hideLoading()
      console.error('保存失败:', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '保存失败', icon: 'none', duration: 4000 })
    }
  },

  deleteSupplier(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    wx.showModal({
      title: '⚠️ 确认删除',
      content: '删除供货商「' + name + '」后，历史订单数据不受影响，但该供货商将不再显示。',
      success: async (res) => {
        if (res.confirm) {
          await cloud.deleteSupplier(id)
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadData()
        }
      }
    })
  },

  deleteStore(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    wx.showModal({
      title: '⚠️ 确认删除',
      content: '删除店铺「' + name + '」后，该店铺将不再显示。',
      success: async (res) => {
        if (res.confirm) {
          await cloud.deleteStore(id)
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadData()
        }
      }
    })
  },

  // ===================== 供货商批量导入 =====================

  onSupplierImportTap() {
    this.setData({
      showSupplierImport: true,
      supplierImportPreview: [],
      supplierImportSelectedCount: 0,
      supplierImportAllSelected: false,
      supplierImportProgress: '',
      supplierImporting: false
    })
  },

  closeSupplierImport() {
    if (this.data.supplierImporting) return
    this.setData({ showSupplierImport: false })
  },

  closeSupplierPasteFallback() {
    this.setData({ showSupplierPasteFallback: false, supplierPasteText: '' })
  },
  onSupplierPasteTextInput(e) {
    this.setData({ supplierPasteText: e.detail.value })
  },
  submitSupplierPasteText() {
    var self = this
    var text = (this.data.supplierPasteText || '').trim()
    if (!text) {
      wx.showToast({ title: '请粘贴内容', icon: 'none' })
      return
    }
    var lines = text.split(/\r\n|\r|\n/).filter(function (l) { return l.trim() })
    if (lines.length < 2) {
      wx.showToast({ title: '数据不足，至少需要表头 + 1 行数据', icon: 'none' })
      return
    }
    var hasTab = lines[0].indexOf('\t') !== -1
    var delimiter = hasTab ? '\t' : ','
    var fieldMap = { '名称': 'name', '联系人': 'contact', '电话': 'phone', '地址': 'address' }
    var headers = lines[0].split(delimiter).map(function (h) { return h.replace(/^"|"$/g, '').trim() })
    var rows = []
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(delimiter).map(function (c) { return c.replace(/^"|"$/g, '').trim() })
      var obj = {}
      headers.forEach(function (h, idx) {
        var field = fieldMap[h]
        if (field) obj[field] = cells[idx] || ''
      })
      if (obj.name) rows.push(obj)
    }
    if (rows.length === 0) {
      wx.showToast({ title: '未解析到有效数据', icon: 'none' })
      return
    }
    if (rows.length > 2) rows = rows.slice(2)
    self.setData({ showSupplierPasteFallback: false, supplierPasteText: '' })
    self._showSupplierImportPreview(rows)
  },

  _showSupplierImportPreview(parsed) {
    var self = this
    var preview = parsed.map(function (row, idx) {
      return {
        idx: idx + 1,
        name: row.name || '(空)',
        contact: row.contact || '',
        phone: row.phone || '(空)',
        address: row.address || '',
        valid: !!(row.name && row.name.trim() && row.phone && row.phone.trim()),
        selected: true
      }
    })
    self.setData({
      supplierImportPreview: preview,
      supplierImportProgress: '',
      supplierImportSelectedCount: preview.length,
      supplierImportAllSelected: preview.length > 0
    })
    self._supplierImportParsed = parsed
  },

  downloadSupplierTemplate() {
    excel.exportExcel({
      filename: '供货商导入模板',
      title: '供货商导入模板（请勿修改表头行）',
      headers: ['名称', '联系人', '电话', '地址'],
      rows: [
        ['示例供货商A', '示例联系人', '13800000001', '示例地址（示例行）'],
        ['示例供货商B', '示例联系人', '13800000002', '示例地址（示例行）']
      ]
    })
  },

  chooseSupplierFile() {
    var self = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: function (res) {
        var filePath = res.tempFiles[0].path
        var fileName = res.tempFiles[0].name || ''
        if (!/\.(xlsx?|csv)$/i.test(fileName)) {
          wx.showModal({
            title: '格式不支持',
            content: '请选择 xlsx / xls / csv 格式文件，当前文件：' + fileName,
            showCancel: false
          })
          return
        }
        var fs = wx.getFileSystemManager()
        fs.readFile({
          filePath: filePath,
          encoding: 'base64',
          success: function (readRes) {
            var base64 = readRes.data
            if (!base64) { wx.showToast({ title: '文件内容为空', icon: 'none' }); return }
            wx.showLoading({ title: '解析中...' })
            excel.parseExcelFile(base64).then(function (rows) {
              wx.hideLoading()
              var items = self._rowsToSupplierItems(rows)
              if (!items || items.length === 0) {
                wx.showModal({ title: '解析失败', content: '未能识别出有效数据，请确认使用了模板并保留表头行。', showCancel: false })
                return
              }
              self._showSupplierImportPreview(items)
            }).catch(function (e) {
              wx.hideLoading()
              var msg = (e && e.message) ? String(e.message) : ''
              if (msg.indexOf('未登录') !== -1 || msg.indexOf('登录') !== -1 || msg.indexOf('会话') !== -1) {
                wx.showToast({ title: '登录已失效，请重新登录', icon: 'none', duration: 3000 })
                return
              }
              self._fallbackParseSupplierFile(filePath, fileName)
            })
          },
          fail: function () { wx.showToast({ title: '读取文件失败', icon: 'none' }) }
        })
      },
      fail: function (err) {
        var msg = (err && err.errMsg) || (err && err.message) || ''
        console.error('chooseMessageFile fail:', err)
        if (msg.indexOf('privacy') !== -1 || msg.indexOf('scope') !== -1) {
          self.setData({ showSupplierPasteFallback: true, supplierPasteText: '' })
          return
        }
        wx.showModal({
          title: '选择文件失败',
          content: '错误：' + msg + '\n\n请确认已用微信发送过该文件，或将内容粘贴导入',
          confirmText: '粘贴导入',
          cancelText: '重试',
          success: function (modalRes) {
            if (modalRes.confirm) {
              self.setData({ showSupplierPasteFallback: true, supplierPasteText: '' })
            }
          }
        })
      }
    })
  },

  // 将云函数返回的二维数组（含表头行）解析为供货商 items
  _rowsToSupplierItems(rows) {
    if (!rows || rows.length < 2) return []
    var fieldMap = { '名称': 'name', '联系人': 'contact', '电话': 'phone', '地址': 'address' }
    var headerIdx = -1
    for (var i = 0; i < rows.length; i++) {
      var matched = 0
      var row = rows[i] || []
      for (var k = 0; k < row.length; k++) {
        if (fieldMap[String(row[k] == null ? '' : row[k]).trim()]) matched++
      }
      if (matched >= 2) { headerIdx = i; break }
    }
    if (headerIdx === -1 || headerIdx + 1 >= rows.length) return []
    var headers = (rows[headerIdx] || []).map(function (h) { return String(h == null ? '' : h).trim() })
    var items = []
    for (var j = headerIdx + 1; j < rows.length; j++) {
      var cells = rows[j] || []
      var obj = {}
      for (var c = 0; c < headers.length; c++) {
        var field = fieldMap[headers[c]]
        if (field) obj[field] = cells[c] == null ? '' : String(cells[c]).trim()
      }
      if (obj.name) items.push(obj)
    }
    return items
  },

  // 本地兜底解析（mock 模式或云解析失败时）：仅支持 XML XLS / CSV 文本
  _fallbackParseSupplierFile(filePath, fileName) {
    var self = this
    var isXLS = /\.xlsx?$/i.test(fileName)
    var fs = wx.getFileSystemManager()
    fs.readFile({
      filePath: filePath,
      encoding: 'utf-8',
      success: function (readRes) {
        try {
          var text = readRes.data
          if (!text) { wx.showToast({ title: '文件内容为空', icon: 'none' }); return }
          var parsed = []
          if (isXLS && (text.indexOf('<Workbook') !== -1 || text.indexOf('<') === 0)) {
            parsed = self.parseSupplierXLS(text)
            if (parsed.length === 0) parsed = self.parseSupplierCSV(text)
          } else {
            parsed = self.parseSupplierCSV(text)
          }
          if (parsed.length === 0) {
            wx.showModal({ title: '解析失败', content: '文件格式无法识别，请使用模板重新导出后编辑。', showCancel: false })
            return
          }
          self._showSupplierImportPreview(parsed)
        } catch (e) {
          wx.showModal({ title: '解析异常', content: String(e).slice(0, 100), showCancel: false })
        }
      },
      fail: function () { wx.showToast({ title: '读取文件失败', icon: 'none' }) }
    })
  },

  // 自动检测文件编码（UTF-8 / GBK），WPS 中文环境默认存 GBK
  _decodeFileText(arrayBuffer) {
    try { var text = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer) } catch (e) {}
    if (text && (text.indexOf('名称') !== -1 || text.indexOf('<Row') !== -1)) return text
    try { var gbkText = new TextDecoder('gbk').decode(arrayBuffer) } catch (e) {}
    return gbkText || text || ''
  },

  parseSupplierCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
    var lines = text.split(/\r\n|\r|\n/).filter(function (l) { return l.trim() })
    if (lines.length < 2) return []

    function parseLine(line) {
      var result = []
      var current = ''
      var inQ = false
      for (var i = 0; i < line.length; i++) {
        var ch = line[i]
        if (inQ) {
          if (ch === '"') { if (line[i + 1] === '"') { current += '"'; i++ } else inQ = false }
          else current += ch
        } else {
          if (ch === '"') inQ = true
          else if (ch === ',') { result.push(current); current = '' }
          else current += ch
        }
      }
      result.push(current)
      return result
    }

    var fieldMap = { '名称': 'name', '联系人': 'contact', '电话': 'phone', '地址': 'address' }
    var headers = parseLine(lines[0]).map(function (h) { return h.trim() })
    var rows = []
    for (var i = 1; i < lines.length; i++) {
      var cells = parseLine(lines[i])
      var obj = {}
      headers.forEach(function (h, idx) {
        var field = fieldMap[h]
        if (field) obj[field] = (cells[idx] || '').trim()
      })
      if (obj.name) rows.push(obj)
    }
    return rows
  },

  parseSupplierXLS(text) {
    var fieldMap = { '名称': 'name', '联系人': 'contact', '电话': 'phone', '地址': 'address' }
    var rowRegex = /<Row[^>]*>/g
    var cellRegex = /<Cell[^>]*>([\s\S]*?)<\/Cell>/g
    var dataRegex = /<Data[^>]*>([\s\S]*?)<\/Data>/

    function decodeXml(s) {
      if (!s) return ''
      return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    }

    var allRows = []
    var match
    while ((match = rowRegex.exec(text)) !== null) {
      var rowStart = match.index + match[0].length
      var rowEnd = text.indexOf('</Row>', rowStart)
      if (rowEnd === -1) continue
      var rowContent = text.substring(rowStart, rowEnd)
      var cells = []
      var cellMatch
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        var idxMatch = cellMatch[0].match(/ss:Index="(\d+)"/)
        if (idxMatch) {
          var targetCol = parseInt(idxMatch[1]) - 1
          while (cells.length < targetCol) cells.push('')
        }
        var dm = cellMatch[1].match(dataRegex)
        cells.push(dm ? decodeXml(dm[1]) : '')
      }
      if (cells.length === 1 && !fieldMap[cells[0].trim()]) continue
      allRows.push(cells)
    }

    var headerIdx = -1
    for (var i = 0; i < allRows.length; i++) {
      var matched = 0
      allRows[i].forEach(function (c) { if (fieldMap[c.trim()]) matched++ })
      if (matched >= 2) { headerIdx = i; break }
    }
    if (headerIdx === -1 || headerIdx + 1 >= allRows.length) return []

    var headers = allRows[headerIdx].map(function (h) { return h.trim() })
    var rows = []
    for (var i = headerIdx + 1; i < allRows.length; i++) {
      var cells = allRows[i]
      var obj = {}
      headers.forEach(function (h, idx) {
        var field = fieldMap[h]
        if (field) obj[field] = (cells[idx] || '').trim()
      })
      if (obj.name) rows.push(obj)
    }
    return rows
  },

  supplierImportToggleItem(e) {
    var idx = e.currentTarget.dataset.idx
    var preview = this.data.supplierImportPreview
    var item = preview.find(function (p) { return p.idx === idx })
    if (!item) return
    item.selected = item.selected === false ? true : false
    var selectedCount = preview.filter(function (p) { return p.selected !== false }).length
    this.setData({
      supplierImportPreview: preview,
      supplierImportSelectedCount: selectedCount,
      supplierImportAllSelected: selectedCount === preview.length && preview.length > 0
    })
  },

  supplierImportToggleAll() {
    var preview = this.data.supplierImportPreview
    var newVal = !this.data.supplierImportAllSelected
    preview.forEach(function (p) { p.selected = newVal })
    this.setData({
      supplierImportPreview: preview,
      supplierImportSelectedCount: newVal ? preview.length : 0,
      supplierImportAllSelected: newVal && preview.length > 0
    })
  },

  async confirmSupplierImport() {
    var preview = this.data.supplierImportPreview
    if (!preview.length) return

    var selectedIdxSet = {}
    preview.forEach(function (p) {
      if (p.selected !== false) selectedIdxSet[p.idx - 1] = true
    })
    if (Object.keys(selectedIdxSet).length === 0) {
      wx.showToast({ title: '请至少选择一条数据', icon: 'none' })
      return
    }

    this.setData({ supplierImporting: true, supplierImportProgress: '正在导入...' })
    wx.showLoading({ title: '批量导入中', mask: true })

    var items = this._supplierImportParsed
      .filter(function (row, idx) { return selectedIdxSet[idx] })
      .map(function (row) {
        return {
          name: row.name,
          contact: row.contact || '',
          phone: row.phone || '',
          address: row.address || '',
          categories: [],
          minOrderAmount: 0,
          settlementType: 'monthly',
          couponType: 'none',
          couponValue: 0,
          status: 'active'
        }
      })

    try {
      var result = await cloud.batchImportSuppliers(items)
      wx.hideLoading()
      var msg = '成功' + result.success + '个' + (result.failed > 0 ? '，失败' + result.failed + '个' : '')
      this.setData({ supplierImporting: false, supplierImportProgress: msg })
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
      if (result.success > 0) {
        setTimeout(async () => {
          this.setData({ showSupplierImport: false, supplierImportPreview: [] })
          await this.loadData()
        }, 1500)
      }
    } catch (e) {
      wx.hideLoading()
      this.setData({ supplierImporting: false, supplierImportProgress: '导入失败: ' + (e.message || '') })
      wx.showToast({ title: '导入失败', icon: 'none' })
    }
  }
})
