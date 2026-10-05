/**
 * 管理员 - 货品上架管理（全局，不绑定店铺）
 */
const cloud = require('../../../utils/cloud.js')
const { CATEGORIES } = require('../../../utils/config.js')
const excel = require('../../../utils/excel.js')

Page({
  data: {
    keyword: '',
    activeCat: 'all',
    catList: [],
    catPicker: [],
    catPickerIdx: 0,
    filteredGoods: [],
    showModal: false,
    modalTitle: '编辑货品',
    supplierSuggestions: [],
    showSuggestions: false,
    showCatModal: false,
    newCatName: '',
    newCatIcon: '\ud83d\udce6',
    allCats: [],
    editingCatId: '',
    editingCatIcon: '',
    editingCatName: '',
    showImportModal: false,
    showPasteFallback: false,
    pasteText: '',
    importPreview: [],
    importSelectedCount: 0,
    importAllSelected: false,
    importProgress: '',
    importing: false,
    form: {
      _id: '',
      code: '',
      name: '',
      category: '',
      categoryName: '',
      unit: '斤',
      price: '',
      specWeight: '',
      specCount: '',
      image: '',
      description: '',
      supplierId: '',
      supplierName: ''
    }
  },

  async onShow() {
    await this.loadData()
  },

  async loadData() {
    wx.showLoading({ title: '加载中...' })
    try {
      const dbCats = await cloud.getCategories()
      const catList = [{ id: 'all', name: '全部' }].concat(dbCats.map(c => ({ id: c.id, name: c.name })))
      const catPicker = dbCats.map(c => ({ id: c.id, name: c.name }))

      this._catMap = {}
      dbCats.forEach(c => { this._catMap[c.id] = c })

      this.setData({ catList, catPicker })

      const data = await cloud.getAdminData()
      wx.hideLoading()
      if (!data) return
      // 预计算本月起始时间，供 filterGoods 按月份统计
      const now = new Date()
      this._monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      this._allOrders = data.orders || []
      this._allSuppliers = (data.suppliers || []).filter(s => s.status === 'active' || !s.status)
      this.filterGoods(data.goods || [])
    } catch (e) {
      wx.hideLoading()
      console.error('loadData error', e)
    }
  },

  filterGoods(allGoods) {
    let list = allGoods
    if (this.data.activeCat !== 'all') {
      list = list.filter(g => g.category === this.data.activeCat)
    }
    if (this.data.keyword) {
      const kw = this.data.keyword.toLowerCase()
      list = list.filter(g =>
        g.name.toLowerCase().includes(kw) ||
        (g.code && g.code.toLowerCase().includes(kw)) ||
        (g.supplierName && g.supplierName.toLowerCase().includes(kw))
      )
    }

    // 统计每个货品的下单数量
    const orders = this._allOrders || []
    const monthStart = this._monthStart || new Date()
    const goodsStats = {}
    orders.forEach(o => {
      if (!o.items || !o.items.length) return
      const isThisMonth = new Date(o.createTime) >= monthStart
      o.items.forEach(it => {
        const gid = it.goodsId
        if (!gid) return
        if (!goodsStats[gid]) goodsStats[gid] = { monthly: 0, total: 0 }
        goodsStats[gid].total += (it.qty || 0)
        if (isThisMonth) goodsStats[gid].monthly += (it.qty || 0)
      })
    })

    const filtered = list.map(g => {
      const stats = goodsStats[g._id]
      return {
        ...g,
        icon: (this._catMap && this._catMap[g.category] ? this._catMap[g.category].icon : '📦'),
        catName: (this._catMap && this._catMap[g.category] ? this._catMap[g.category].name : '其他'),
        hasImage: !!(g.image && g.image.length > 0),
        monthlyOrderCount: stats ? stats.monthly : 0,
        totalOrderCount: stats ? stats.total : 0,
        onShelf: g.onShelf !== false
      }
    })
    this.setData({ filteredGoods: filtered })
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    const goods = cloud.list('goods')
    if (goods) this.filterGoods(goods)
  },

  onCatTap(e) {
    this.setData({ activeCat: e.currentTarget.dataset.id })
    const goods = cloud.list('goods')
    if (goods) this.filterGoods(goods)
  },

  onGoodsTap(e) {
    const g = this.data.filteredGoods[e.currentTarget.dataset.idx]
    const catIdx = this.data.catPicker.findIndex(c => c.id === g.category)
    this.setData({
      showModal: true,
      modalTitle: '编辑货品',
      catPickerIdx: Math.max(0, catIdx),
      form: {
        _id: g._id,
        code: g.code || '',
        name: g.name || '',
        category: g.category || '',
        categoryName: (this._catMap && this._catMap[g.category] ? this._catMap[g.category].name : '其他'),
        unit: g.unit || '斤',
        price: String(g.price || ''),
        specWeight: g.specWeight || '',
        specCount: g.specCount || '',
        image: g.image || '',
        description: g.description || '',
        supplierId: g.supplierId || '',
        supplierName: g.supplierName || ''
      }
    })
  },

  onAddTap() {
    const firstCat = this.data.catPicker[0] || { id: 'other', name: '其他' }
    this.setData({
      showModal: true,
      modalTitle: '新增货品',
      catPickerIdx: 0,
      form: {
        _id: '',
        code: '',
        name: '',
        category: firstCat.id,
        categoryName: firstCat.name,
        unit: '斤',
        price: '',
        specWeight: '',
        specCount: '',
        image: '',
        description: '',
        supplierId: '',
        supplierName: ''
      }
    })
  },

  onFormChange(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onSupplierInput(e) {
    const val = e.detail.value
    this.setData({ 'form.supplierName': val })
    if (!val || !val.trim()) {
      this.setData({ supplierSuggestions: [], showSuggestions: false })
      return
    }
    const kw = val.trim().toLowerCase()
    const suppliers = this._allSuppliers || []
    const matched = suppliers.filter(s =>
      (s.name && s.name.toLowerCase().indexOf(kw) > -1) ||
      (s.contact && s.contact.toLowerCase().indexOf(kw) > -1)
    ).slice(0, 8)
    this.setData({ supplierSuggestions: matched, showSuggestions: matched.length > 0 })
  },

  onSelectSupplier(e) {
    const idx = e.currentTarget.dataset.idx
    const sup = this.data.supplierSuggestions[idx]
    this.setData({
      'form.supplierName': sup.name,
      'form.supplierId': sup._id,
      supplierSuggestions: [],
      showSuggestions: false
    })
  },

  hideSupplierSuggestions() {
    this.setData({ showSuggestions: false })
  },

  onPickerCat(e) {
    const idx = Number(e.detail.value)
    const cat = this.data.catPicker[idx]
    this.setData({ 'form.category': cat.id, 'form.categoryName': cat.name, catPickerIdx: idx })
  },

  onChooseImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempPath = res.tempFilePaths[0]
        // 直接存储临时路径，由 cloud.js saveGoods 上传到云存储
        this.setData({ 'form.image': tempPath })
      }
    })
  },

  onRemoveImage() {
    this.setData({ 'form.image': '' })
  },

  async openCatModal() {
    const dbCats = await cloud.getCategories()
    this.setData({ showCatModal: true, allCats: dbCats, newCatName: '', newCatIcon: '\ud83d\udce6' })
  },

  closeCatModal() {
    this.setData({ showCatModal: false })
  },

  onNewCatName(e) {
    this.setData({ newCatName: e.detail.value })
  },

  onNewCatIcon(e) {
    this.setData({ newCatIcon: e.detail.value })
  },

  async addNewCat() {
    const name = this.data.newCatName.trim()
    if (!name) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' })
      return
    }
    const id = 'cat_' + Date.now()
    const cat = await cloud.addCategory({ id: id, name: name, icon: this.data.newCatIcon || '\ud83d\udce6' })
    if (!cat) {
      wx.showToast({ title: '分类已存在', icon: 'none' })
      return
    }
    wx.showToast({ title: '已添加', icon: 'success' })
    const dbCats = await cloud.getCategories()
    this.setData({ newCatName: '', newCatIcon: '\ud83d\udce6', allCats: dbCats })
    await this.loadData()
  },

  deleteCat(e) {
    const catId = e.currentTarget.dataset.id
    const catName = e.currentTarget.dataset.name
    wx.showModal({
      title: '删除分类',
      content: '确定删除「' + catName + '」？该分类下的货品不受影响。',
      success: async (res) => {
        if (res.confirm) {
          await cloud.deleteCategory(catId)
          wx.showToast({ title: '已删除', icon: 'success' })
          const dbCats = await cloud.getCategories()
          this.setData({ allCats: dbCats })
          await this.loadData()
        }
      }
    })
  },

  startEditCat(e) {
    const catId = e.currentTarget.dataset.id
    const cat = this.data.allCats.find(c => c._id === catId || c.id === catId)
    if (!cat) return
    this.setData({
      editingCatId: catId,
      editingCatIcon: cat.icon || '\ud83d\udce6',
      editingCatName: cat.name
    })
  },

  onEditCatIcon(e) {
    this.setData({ editingCatIcon: e.detail.value })
  },

  onEditCatName(e) {
    this.setData({ editingCatName: e.detail.value })
  },

  cancelEditCat() {
    this.setData({ editingCatId: '', editingCatIcon: '', editingCatName: '' })
  },

  async saveEditCat() {
    const name = this.data.editingCatName.trim()
    if (!name) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中...' })
    await cloud.updateCategory(this.data.editingCatId, {
      name: name,
      icon: this.data.editingCatIcon || '\ud83d\udce6'
    })
    wx.hideLoading()
    wx.showToast({ title: '已修改', icon: 'success' })
    this.setData({ editingCatId: '', editingCatIcon: '', editingCatName: '' })
    const dbCats = await cloud.getCategories()
    this.setData({ allCats: dbCats })
    await this.loadData()
  },

  closeModal() {
    this.setData({ showModal: false })
  },

  async saveGoods() {
    const f = this.data.form
    if (!f.name.trim()) {
      wx.showToast({ title: '请输入货品名称', icon: 'none' })
      return
    }
    try {
    wx.showLoading({ title: '保存中...' })
    const saveData = {
      code: f.code || '',
      name: f.name.trim(),
      category: f.category,
      unit: f.unit.trim() || '斤',
      price: Number(f.price) || 0,
      specWeight: f.specWeight.trim(),
      specCount: f.specCount.trim(),
      image: f.image || '',
      description: f.description.trim(),
      supplierId: '',
      supplierName: ''
    }

    if (f.supplierName && f.supplierName.trim()) {
      saveData.supplierId = await cloud.resolveSupplier(f.supplierName.trim()) || ''
      saveData.supplierName = f.supplierName.trim()
    }

    if (f._id) {
      saveData._id = f._id
    }

    await cloud.saveGoods(saveData)
    wx.hideLoading()
    this.setData({ showModal: false })
    wx.showToast({ title: '保存成功', icon: 'success' })
    await this.loadData()
    } catch (e) {
      wx.hideLoading()
      wx.showModal({ title: '保存失败', content: String(e.message || e).slice(0, 80), showCancel: false })
    }
  },

  deleteGoods() {
    const f = this.data.form
    if (!f._id) return
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定删除该货品？',
      success: async (res) => {
        if (res.confirm) {
          await cloud.deleteGoods(f._id)
          this.setData({ showModal: false })
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadData()
        }
      }
    })
  },

  // 上架/下架切换（saveGoods 为部分更新，仅改 onShelf 字段）
  async toggleShelf(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.filteredGoods.find(g => g._id === id)
    if (!item) return
    const newShelf = !(item.onShelf !== false)
    try {
      await cloud.saveGoods({ _id: id, onShelf: newShelf })
      wx.showToast({ title: newShelf ? '已上架' : '已下架', icon: 'none' })
      await this.loadData()
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // ===================== 批量导入 =====================

  onImportTap() {
    this.setData({ showImportModal: true, importPreview: [], importSelectedCount: 0, importAllSelected: false, importProgress: '', importing: false })
  },

  closeImportModal() {
    if (this.data.importing) return
    this.setData({ showImportModal: false })
  },

  // 粘贴降级弹窗
  closePasteFallback() {
    this.setData({ showPasteFallback: false, pasteText: '' })
  },
  onPasteTextInput(e) {
    this.setData({ pasteText: e.detail.value })
  },
  submitPasteText() {
    var self = this
    var text = (this.data.pasteText || '').trim()
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
    var parsed = self._parseDelimited(lines, delimiter,
      { '编号': 'code', '名称': 'name', '分类': 'category', '单位': 'unit', '规格重量': 'specWeight', '规格数量': 'specCount', '单价': 'price', '供货商': 'supplierName', '说明': 'description' })
    if (parsed.length === 0) {
      wx.showToast({ title: '未解析到有效数据', icon: 'none' })
      return
    }
    if (parsed.length > 2) parsed = parsed.slice(2)
    self.setData({ showPasteFallback: false, pasteText: '' })
    self._showImportPreview(parsed)
  },

  // 通用分隔符解析
  _parseDelimited(lines, delimiter, fieldMap) {
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
    return rows
  },

  // 展示导入预览
  _showImportPreview(parsed) {
    var self = this
    var catNameMap = {}
    ;(this.data.catPicker || []).forEach(function (c) { catNameMap[c.name] = c.id })
    var preview = parsed.map(function (row, idx) {
      var catId = catNameMap[row.category] || ''
      return {
        idx: idx + 1,
        code: row.code || '(自动)',
        name: row.name || '(空)',
        category: row.category || '(未匹配)',
        unit: row.unit || '斤',
        price: row.price || '0',
        supplierName: row.supplierName || '-',
        catMatched: !!catId,
        valid: !!(row.name && row.name.trim()),
        selected: true
      }
    })
    self.setData({
      importPreview: preview,
      importProgress: '',
      importSelectedCount: preview.length,
      importAllSelected: preview.length > 0
    })
    self._importParsedData = parsed
  },

  // 切换单条选中
  importToggleItem(e) {
    const idx = e.currentTarget.dataset.idx
    var preview = this.data.importPreview
    var item = preview.find(function (p) { return p.idx === idx })
    if (!item) return
    item.selected = item.selected === false ? true : false
    var selectedCount = preview.filter(function (p) { return p.selected !== false }).length
    this.setData({
      importPreview: preview,
      importSelectedCount: selectedCount,
      importAllSelected: selectedCount === preview.length && preview.length > 0
    })
  },

  // 全选 / 取消全选
  importToggleAll() {
    var preview = this.data.importPreview
    var newVal = !this.data.importAllSelected
    preview.forEach(function (p) { p.selected = newVal })
    this.setData({
      importPreview: preview,
      importSelectedCount: newVal ? preview.length : 0,
      importAllSelected: newVal && preview.length > 0
    })
  },

  downloadTemplate() {
    excel.exportExcel({
      filename: '商品导入模板',
      title: '商品导入模板（请勿修改表头行）',
      headers: ['编号', '名称', '分类', '单位', '规格重量', '规格数量', '单价', '供货商', '说明'],
      rows: [
        ['', '白菜', '蔬菜', '斤', '500g', '1份', '3.5', '示例供货商A', '新鲜白菜（示例行）'],
        ['', '猪肉', '肉类', '斤', '500g', '1份', '18', '示例供货商B', '（示例行）']
      ]
    })
  },

  chooseImportFile() {
    var self = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: function (res) {
        var filePath = res.tempFiles[0].path
        var fileName = res.tempFiles[0].name || ''
        // 校验文件类型（xlsx/xls/csv，云函数会自动识别格式）
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
              var items = self._rowsToItems(rows)
              if (!items || items.length === 0) {
                wx.showModal({ title: '解析失败', content: '未能识别出有效数据，请确认使用了模板并保留表头行。', showCancel: false })
                return
              }
              self._showImportPreview(items)
            }).catch(function (e) {
              wx.hideLoading()
              var msg = (e && e.message) ? String(e.message) : ''
              if (msg.indexOf('未登录') !== -1 || msg.indexOf('登录') !== -1 || msg.indexOf('会话') !== -1) {
                wx.showToast({ title: '登录已失效，请重新登录', icon: 'none', duration: 3000 })
                return
              }
              // 云解析失败（如本地 mock 模式）回退到本地解析
              self._fallbackParseFile(filePath, fileName)
            })
          },
          fail: function () { wx.showToast({ title: '读取文件失败', icon: 'none' }) }
        })
      },
      fail: function (err) {
        var msg = (err && err.errMsg) || (err && err.message) || ''
        console.error('chooseMessageFile fail:', err)
        // 隐私 scope 未授权（开发阶段常见），直接弹粘贴导入
        if (msg.indexOf('privacy') !== -1 || msg.indexOf('scope') !== -1) {
          self.setData({ showPasteFallback: true, pasteText: '' })
          return
        }
        wx.showModal({
          title: '选择文件失败',
          content: '错误：' + msg + '\n\n请确认已用微信发送过该文件，或将内容粘贴导入',
          confirmText: '粘贴导入',
          cancelText: '重试',
          success: function (modalRes) {
            if (modalRes.confirm) {
              self.setData({ showPasteFallback: true, pasteText: '' })
            }
          }
        })
      }
    })
  },

  // 将云函数返回的二维数组（含表头行）解析为导入 items
  _rowsToItems(rows) {
    if (!rows || rows.length < 2) return []
    var fieldMap = {
      '编号': 'code', '名称': 'name', '分类': 'category',
      '单位': 'unit', '规格重量': 'specWeight', '规格数量': 'specCount',
      '单价': 'price', '供货商': 'supplierName', '说明': 'description'
    }
    // 找表头行：第一个匹配 ≥4 个字段名的行
    var headerIdx = -1
    for (var i = 0; i < rows.length; i++) {
      var matched = 0
      var row = rows[i] || []
      for (var k = 0; k < row.length; k++) {
        if (fieldMap[String(row[k] == null ? '' : row[k]).trim()]) matched++
      }
      if (matched >= 4) { headerIdx = i; break }
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
  _fallbackParseFile(filePath, fileName) {
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
            parsed = self.parseXLS(text)
            if (parsed.length === 0) parsed = self.parseCSV(text)
          } else {
            parsed = self.parseCSV(text)
          }
          if (parsed.length === 0) {
            wx.showModal({ title: '解析失败', content: '文件格式无法识别，请使用模板重新导出后编辑。', showCancel: false })
            return
          }
          self._showImportPreview(parsed)
        } catch (e) {
          wx.showModal({ title: '解析异常', content: String(e).slice(0, 100), showCancel: false })
        }
      },
      fail: function () { wx.showToast({ title: '读取文件失败', icon: 'none' }) }
    })
  },

  parseCSV(text) {
    // 去 BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
    const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim())
    if (lines.length < 2) return []

    function parseLine(line) {
      const result = []
      let current = ''
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') { current += '"'; i++ }
            else inQuotes = false
          } else current += ch
        } else {
          if (ch === '"') inQuotes = true
          else if (ch === ',') { result.push(current); current = '' }
          else current += ch
        }
      }
      result.push(current)
      return result
    }

    const fieldMap = {
      '编号': 'code', '名称': 'name', '分类': 'category',
      '单位': 'unit', '规格重量': 'specWeight', '规格数量': 'specCount',
      '单价': 'price', '供货商': 'supplierName', '说明': 'description'
    }

    const headers = parseLine(lines[0]).map(h => h.trim())
    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const cells = parseLine(lines[i])
      const obj = {}
      headers.forEach((h, idx) => {
        const field = fieldMap[h]
        if (field) obj[field] = (cells[idx] || '').trim()
      })
      if (obj.name) rows.push(obj)
    }
    return rows
  },

  parseXLS(text) {
    const fieldMap = {
      '编号': 'code', '名称': 'name', '分类': 'category',
      '单位': 'unit', '规格重量': 'specWeight', '规格数量': 'specCount',
      '单价': 'price', '供货商': 'supplierName', '说明': 'description'
    }
    // 匹配整个 <Row ...> 标签（包括 ss:Index 等属性），直到 </Row>
    var rowRegex = /<Row[^>]*>/g
    var cellRegex = /<Cell[^>]*>([\s\S]*?)<\/Cell>/g
    var dataRegex = /<Data[^>]*>([\s\S]*?)<\/Data>/

    // 第一步：收集所有行数据
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
        // 处理 ss:Index 属性（Excel 跳过空列时使用，如 <Cell ss:Index="2">）
        var idxMatch = cellMatch[0].match(/ss:Index="(\d+)"/)
        if (idxMatch) {
          var targetCol = parseInt(idxMatch[1]) - 1  // 1-based to 0-based
          while (cells.length < targetCol) cells.push('')
        }
        var dm = cellMatch[1].match(dataRegex)
        cells.push(dm ? this._decodeXml(dm[1]) : '')
      }
      // 跳过纯标题行（如"商品导入模板"只有一个合并单元格，不匹配任何字段名）
      if (cells.length === 1 && !fieldMap[cells[0].trim()]) continue
      allRows.push(cells)
    }

    // 第二步：寻找表头行（第一个有 ≥4 个单元格匹配 fieldMap 键的行）
    var headerIdx = -1
    for (var i = 0; i < allRows.length; i++) {
      var matched = 0
      allRows[i].forEach(function (c) { if (fieldMap[c.trim()]) matched++ })
      if (matched >= 4) { headerIdx = i; break }
    }
    if (headerIdx === -1 || headerIdx + 1 >= allRows.length) return []

    var headers = allRows[headerIdx].map(function (h) { return h.trim() })

    // 第三步：从表头下一行开始解析数据
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

  _decodeXml(s) {
    if (!s) return ''
    return s.replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
  },

  // 自动检测文件编码（UTF-8 / GBK），WPS 中文环境默认存 GBK
  _decodeFileText(arrayBuffer) {
    // 先试 UTF-8
    try { var text = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer) } catch (e) {}
    if (text && (text.indexOf('名称') !== -1 || text.indexOf('<Row') !== -1)) return text
    // UTF-8 不包含中文字段名 → 试 GBK
    try { var gbkText = new TextDecoder('gbk').decode(arrayBuffer) } catch (e) {}
    return gbkText || text || ''
  },

  async confirmImport() {
    const preview = this.data.importPreview
    if (!preview.length) return

    // 获取选中的行索引（preview.idx - 1 = _importParsedData 索引）
    const selectedIdxSet = {}
    preview.forEach(function (p) {
      if (p.selected !== false) selectedIdxSet[p.idx - 1] = true
    })
    const selectedCount = Object.keys(selectedIdxSet).length
    if (selectedCount === 0) {
      wx.showToast({ title: '请至少选择一条数据', icon: 'none' })
      return
    }

    // 只对选中的行检查分类匹配
    const selectedPreview = preview.filter(p => p.selected !== false)
    const unmatched = selectedPreview.filter(p => !p.catMatched && p.category !== '(未匹配)' && p.category !== '-' && p.category !== '')
    if (unmatched.length > 0) {
      const names = unmatched.map(p => p.category).filter((v, i, a) => a.indexOf(v) === i).join('、')
      const res = await new Promise(resolve => {
        wx.showModal({
          title: '分类未匹配',
          content: '以下分类不存在，对应商品将归入第一个分类：\n' + names,
          confirmText: '继续导入',
          success: r => resolve(r.confirm)
        })
      })
      if (!res) return
    }

    this.setData({ importing: true, importProgress: '正在导入...' })
    wx.showLoading({ title: '批量导入中', mask: true })

    // 重建导入数据（仅选中的行）
    const catNameMap = {}
    ;(this.data.catPicker || []).forEach(c => { catNameMap[c.name] = c.id })
    const firstCatId = (this.data.catPicker[0] || { id: 'other' }).id

    const items = this._importParsedData
      .filter(function (row, idx) { return selectedIdxSet[idx] })
      .map(function (row) {
        return {
          code: row.code || '',
          name: row.name,
          category: catNameMap[row.category] || firstCatId,
          unit: row.unit || '斤',
          specWeight: row.specWeight || '',
          specCount: row.specCount || '',
          price: Number(row.price) || 0,
          description: row.description || '',
          supplierName: row.supplierName || '',
          image: ''
        }
      })

    try {
      const result = await cloud.batchImportGoods(items)
      wx.hideLoading()
      const msg = '成功' + result.success + '条' + (result.failed > 0 ? '，失败' + result.failed + '条' : '')
      this.setData({ importing: false, importProgress: msg })
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })

      if (result.errors && result.errors.length > 0) {
        console.log('导入错误:', result.errors)
      }

      // 导入成功后刷新数据
      if (result.success > 0) {
        setTimeout(async () => {
          this.setData({ showImportModal: false, importPreview: [] })
          await this.loadData()
        }, 1500)
      }
    } catch (e) {
      wx.hideLoading()
      this.setData({ importing: false, importProgress: '导入失败: ' + (e.message || '') })
      wx.showToast({ title: '导入失败', icon: 'none' })
    }
  }
})
