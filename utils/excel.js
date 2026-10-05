/**
 * Excel 导出工具（兼容 WPS / 安卓 / 鸿蒙）
 *
 * 主格式：SpreadsheetML 2003 XML（.xls），WPS/Excel/LibreOffice 原生支持
 * 备选格式：CSV + UTF-8 BOM（.csv），最大兼容性
 *
 * 通过 wx.openDocument 打开，用户可分享/保存
 */

const { CLOUD_ENV_ID } = require('./config.js')
const USE_CLOUD = !!(CLOUD_ENV_ID && CLOUD_ENV_ID !== 'mock')

// 运行时检测 wx.cloud 是否可用
function _cloudReady() {
  return typeof wx !== 'undefined' && typeof wx.cloud !== 'undefined' && typeof wx.cloud.callFunction === 'function'
}

// 调用 excel 云函数（附鉴权信息，与 cloud.js callApi 一致）
function _callExcel(action, payload) {
  return new Promise((resolve, reject) => {
    var data = Object.assign({}, payload || {})
    try {
      var user = wx.getStorageSync('syx_user')
      if (user && user._id) data.callerUserId = user._id
      var token = wx.getStorageSync('syx_session_token')
      if (token) data.sessionToken = token
    } catch (e) {}
    wx.cloud.callFunction({
      name: 'excel',
      data: { action: action, data: data },
      success: function (res) {
        if (res.result && res.result.success !== false) {
          resolve(res.result)
        } else {
          reject(new Error((res.result && res.result.message) || '操作失败'))
        }
      },
      fail: function (err) {
        reject(err)
      }
    })
  })
}

/**
 * XML 特殊字符转义
 */
function escapeXml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 判断值是否为纯数字（不含单位/符号）
 */
function isNumeric(val) {
  if (val === '' || val === null || val === undefined) return false
  if (typeof val === 'number') return !isNaN(val) && isFinite(val)
  if (typeof val === 'string') {
    var t = val.trim()
    return t !== '' && /^-?\d+(\.\d+)?$/.test(t)
  }
  return false
}

/**
 * 导出 Excel（SpreadsheetML 2003 XML 格式）
 *
 * @param {Object} options
 * @param {string} options.filename - 文件名（不含扩展名）
 * @param {string} options.title - 标题（显示在表格首行）
 * @param {Array<string>} options.headers - 表头 ['列1','列2']
 * @param {Array<Array>} options.rows - 数据行 [['值1','值2']]
 * @param {Array<Array>} [options.summaryRows] - 汇总行（可选）
 */
// 通过 excel 云函数生成标准 xlsx 并打开（手机 WPS/Office 原生支持）
function _exportXlsxCloud(options) {
  var filename = options.filename || '报表'
  return _callExcel('exportXlsx', {
    filename: filename,
    title: options.title,
    headers: options.headers,
    rows: options.rows,
    summaryRows: options.summaryRows
  }).then(function (res) {
    if (!res.fileID) throw new Error('导出失败')
    return new Promise(function (resolve, reject) {
      wx.cloud.downloadFile({
        fileID: res.fileID,
        success: function (dl) {
          if (dl.statusCode !== 200) { reject(new Error('下载失败')); return }
          wx.openDocument({
            filePath: dl.tempFilePath,
            fileType: 'xlsx',
            showMenu: true,
            success: function () {
              wx.showToast({ title: '已打开，可分享保存', icon: 'none', duration: 2500 })
              resolve()
            },
            fail: function () {
              wx.showToast({ title: '文件已生成，请用WPS/Office打开', icon: 'none', duration: 3000 })
              resolve()
            }
          })
        },
        fail: function (err) { reject(err) }
      })
    })
  }).catch(function (e) {
    console.error('[excel] 导出失败:', e)
    var msg = (e && e.message) ? String(e.message) : ''
    if (msg.indexOf('未登录') !== -1 || msg.indexOf('登录') !== -1) {
      wx.showToast({ title: '登录已失效，请重新登录', icon: 'none', duration: 3000 })
    } else {
      wx.showToast({ title: '导出失败，请确认已部署 excel 云函数并安装依赖', icon: 'none', duration: 4000 })
    }
  })
}

// 导出 Excel：云端生成标准 xlsx，本地(mock)降级为 SpreadsheetML
function exportExcel(options) {
  if (USE_CLOUD && _cloudReady()) {
    return _exportXlsxCloud(options)
  }
  return _exportXlsLocal(options)
}

// 本地(mock)模式：SpreadsheetML 2003 XML
function _exportXlsLocal(options) {
  var filename = options.filename || '报表'
  var title = options.title || filename
  var headers = options.headers || []
  var rows = options.rows || []
  var summaryRows = options.summaryRows || []
  var colCount = headers.length || 1

  // ========== 构建 SpreadsheetML 2003 XML ==========
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += '<?mso-application progid="Excel.Sheet"?>\n'
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
  xml += ' xmlns:o="urn:schemas-microsoft-com:office:office"'
  xml += ' xmlns:x="urn:schemas-microsoft-com:office:excel"'
  xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"'
  xml += ' xmlns:html="http://www.w3.org/TR/REC-html40">\n'

  // ========== 样式定义 ==========
  xml += '<Styles>\n'
  // 默认样式
  xml += '<Style ss:ID="Default" ss:Name="Normal">'
  xml += '<Font ss:FontName="\u5B8B\u4F53" ss:Size="11"/>'
  xml += '<Alignment ss:Vertical="Center"/>'
  xml += '</Style>\n'
  // 标题行：绿底白字、粗体、居中
  xml += '<Style ss:ID="Title">'
  xml += '<Font ss:FontName="\u5FAE\u8F6F\u96C5\u9ED1" ss:Size="14" ss:Bold="1" ss:Color="#FFFFFF"/>'
  xml += '<Interior ss:Color="#0F766E" ss:Pattern="Solid"/>'
  xml += '<Alignment ss:Horizontal="Center" ss:Vertical="Center"/>'
  xml += '</Style>\n'
  // 表头：浅绿底、粗体、居中、带边框
  xml += '<Style ss:ID="Header">'
  xml += '<Font ss:FontName="\u5FAE\u8F6F\u96C5\u9ED1" ss:Size="11" ss:Bold="1" ss:Color="#1E293B"/>'
  xml += '<Interior ss:Color="#F0FDFA" ss:Pattern="Solid"/>'
  xml += '<Alignment ss:Horizontal="Center" ss:Vertical="Center"/>'
  xml += _borderXml('#CCCCCC')
  xml += '</Style>\n'
  // 数据行-文本：左对齐、带边框
  xml += '<Style ss:ID="DataText">'
  xml += '<Font ss:FontName="\u5B8B\u4F53" ss:Size="11"/>'
  xml += '<Alignment ss:Vertical="Center"/>'
  xml += _borderXml('#E5E7EB')
  xml += '</Style>\n'
  // 数据行-数字：右对齐、带边框
  xml += '<Style ss:ID="DataNum">'
  xml += '<Font ss:FontName="\u5B8B\u4F53" ss:Size="11"/>'
  xml += '<NumberFormat ss:Format="General"/>'
  xml += '<Alignment ss:Horizontal="Right" ss:Vertical="Center"/>'
  xml += _borderXml('#E5E7EB')
  xml += '</Style>\n'
  // 汇总行：黄底、粗体、带边框
  xml += '<Style ss:ID="Summary">'
  xml += '<Font ss:FontName="\u5FAE\u8F6F\u96C5\u9ED1" ss:Size="11" ss:Bold="1" ss:Color="#1E293B"/>'
  xml += '<Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/>'
  xml += '<Alignment ss:Vertical="Center"/>'
  xml += _borderXml('#CCCCCC')
  xml += '</Style>\n'
  // 汇总行-数字：黄底、粗体、右对齐
  xml += '<Style ss:ID="SummaryNum">'
  xml += '<Font ss:FontName="\u5FAE\u8F6F\u96C5\u9ED1" ss:Size="11" ss:Bold="1" ss:Color="#1E293B"/>'
  xml += '<Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/>'
  xml += '<NumberFormat ss:Format="General"/>'
  xml += '<Alignment ss:Horizontal="Right" ss:Vertical="Center"/>'
  xml += _borderXml('#CCCCCC')
  xml += '</Style>\n'
  xml += '</Styles>\n'

  // ========== 工作表 ==========
  xml += '<Worksheet ss:Name="Sheet1">\n'
  xml += '<Table>\n'

  // 标题行（合并所有列）
  xml += '<Row ss:StyleID="Title">'
  xml += '<Cell ss:MergeAcross="' + (colCount - 1) + '">'
  xml += '<Data ss:Type="String">' + escapeXml(title) + '</Data>'
  xml += '</Cell>'
  xml += '</Row>\n'

  // 表头行
  xml += '<Row ss:StyleID="Header">'
  for (var h = 0; h < colCount; h++) {
    xml += '<Cell><Data ss:Type="String">' + escapeXml(headers[h]) + '</Data></Cell>'
  }
  xml += '</Row>\n'

  // 数据行
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r]
    xml += '<Row>'
    for (var c = 0; c < colCount; c++) {
      var val = row[c]
      if (isNumeric(val)) {
        xml += '<Cell ss:StyleID="DataNum"><Data ss:Type="Number">' + escapeXml(val) + '</Data></Cell>'
      } else {
        xml += '<Cell ss:StyleID="DataText"><Data ss:Type="String">' + escapeXml(val != null ? val : '') + '</Data></Cell>'
      }
    }
    xml += '</Row>\n'
  }

  // 汇总行
  for (var s = 0; s < summaryRows.length; s++) {
    var srow = summaryRows[s]
    xml += '<Row>'
    for (var sc = 0; sc < colCount; sc++) {
      var sval = srow[sc]
      if (isNumeric(sval)) {
        xml += '<Cell ss:StyleID="SummaryNum"><Data ss:Type="Number">' + escapeXml(sval) + '</Data></Cell>'
      } else {
        xml += '<Cell ss:StyleID="Summary"><Data ss:Type="String">' + escapeXml(sval != null ? sval : '') + '</Data></Cell>'
      }
    }
    xml += '</Row>\n'
  }

  xml += '</Table>\n'
  xml += '</Worksheet>\n'
  xml += '</Workbook>'

  // ========== 写入文件 ==========
  var fs = wx.getFileSystemManager()
  var filePath = wx.env.USER_DATA_PATH + '/' + filename + '.xls'

  return new Promise(function (resolve, reject) {
    fs.writeFile({
      filePath: filePath,
      data: xml,
      encoding: 'utf-8',
      success: function () {
        wx.openDocument({
          filePath: filePath,
          fileType: 'xls',
          showMenu: true,
          success: function () {
            wx.showToast({ title: '\u5DF2\u6253\u5F00\uFF0C\u53EF\u5206\u4EAB\u4FDD\u5B58', icon: 'none', duration: 2500 })
            resolve()
          },
          fail: function (err) {
            console.error('openDocument fail:', err)
            // openDocument 失败时尝试 CSV 兜底
            _tryCSVFallback(options, resolve)
          }
        })
      },
      fail: function (err) {
        console.error('writeFile fail:', err)
        wx.showToast({ title: '\u5BFC\u51FA\u5931\u8D25', icon: 'none' })
        reject(err)
      }
    })
  })
}

/**
 * 生成四边边框 XML
 */
function _borderXml(color) {
  var b = '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="' + color + '"/>'
  b += '<Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="' + color + '"/>'
  b += '<Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="' + color + '"/>'
  b += '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="' + color + '"/>'
  return b
}

/**
 * CSV 兜底：当 xls 格式无法打开时，自动转为 CSV（UTF-8 BOM）
 */
function _tryCSVFallback(options, resolve) {
  var filename = options.filename || '报表'
  var headers = options.headers || []
  var rows = options.rows || []
  var summaryRows = options.summaryRows || []

  function csvCell(val) {
    if (val == null) return ''
    var s = String(val)
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  var lines = []
  if (options.title) lines.push(csvCell(options.title))
  lines.push(headers.map(csvCell).join(','))
  rows.forEach(function (row) {
    lines.push(headers.map(function (_, i) { return csvCell(row[i]) }).join(','))
  })
  summaryRows.forEach(function (row) {
    lines.push(headers.map(function (_, i) { return csvCell(row[i]) }).join(','))
  })

  // UTF-8 BOM 确保中文兼容
  var csv = '\uFEFF' + lines.join('\n')
  var fs = wx.getFileSystemManager()
  var csvPath = wx.env.USER_DATA_PATH + '/' + filename + '.csv'

  fs.writeFile({
    filePath: csvPath,
    data: csv,
    encoding: 'utf-8',
    success: function () {
      wx.openDocument({
        filePath: csvPath,
        fileType: 'csv',
        showMenu: true,
        success: function () {
          wx.showToast({ title: '\u5DF2\u6253\u5F00CSV\uFF0C\u53EF\u5206\u4EAB\u4FDD\u5B58', icon: 'none', duration: 2500 })
          resolve()
        },
        fail: function () {
          wx.showToast({ title: '\u6587\u4EF6\u5DF2\u751F\u6210\uFF0C\u8BF7\u7528WPS\u6253\u5F00', icon: 'none', duration: 3000 })
          resolve()
        }
      })
    },
    fail: function () {
      wx.showToast({ title: '\u5BFC\u51FA\u5931\u8D25', icon: 'none' })
      resolve()
    }
  })
}

/**
 * 直接导出 CSV（UTF-8 BOM，最大兼容性）
 * 可在调用方手动选择此格式
 */
function exportCSV(options) {
  var filename = options.filename || '报表'
  var headers = options.headers || []
  var rows = options.rows || []
  var summaryRows = options.summaryRows || []
  var colCount = headers.length

  function csvCell(val) {
    if (val == null) return ''
    var s = String(val)
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  var lines = []
  if (options.title) lines.push(csvCell(options.title))
  lines.push(headers.map(csvCell).join(','))
  rows.forEach(function (row) {
    var cells = []
    for (var i = 0; i < colCount; i++) cells.push(csvCell(row[i]))
    lines.push(cells.join(','))
  })
  summaryRows.forEach(function (row) {
    var cells = []
    for (var i = 0; i < colCount; i++) cells.push(csvCell(row[i]))
    lines.push(cells.join(','))
  })

  var csv = '\uFEFF' + lines.join('\n')
  var fs = wx.getFileSystemManager()
  var filePath = wx.env.USER_DATA_PATH + '/' + filename + '.csv'

  return new Promise(function (resolve, reject) {
    fs.writeFile({
      filePath: filePath,
      data: csv,
      encoding: 'utf-8',
      success: function () {
        wx.openDocument({
          filePath: filePath,
          fileType: 'csv',
          showMenu: true,
          success: function () {
            wx.showToast({ title: '\u5DF2\u6253\u5F00\uFF0C\u53EF\u5206\u4EAB\u4FDD\u5B58', icon: 'none', duration: 2500 })
            resolve()
          },
          fail: function () {
            wx.showToast({ title: '\u6587\u4EF6\u5DF2\u751F\u6210\uFF0C\u8BF7\u7528WPS\u6253\u5F00', icon: 'none' })
            resolve()
          }
        })
      },
      fail: function (err) {
        wx.showToast({ title: '\u5BFC\u51FA\u5931\u8D25', icon: 'none' })
        reject(err)
      }
    })
  })
}

module.exports = { exportExcel, exportCSV, exportMultiSheetExcel, parseExcelFile }

/**
 * 导出多 Sheet Excel（SpreadsheetML 2003 XML 格式）
 *
 * @param {Array} sheets - 工作表数组 [{ name, headers, rows }]
 * @param {string} filename - 文件名（不含扩展名）
 */
function exportMultiSheetExcel(sheets, filename) {
  filename = filename || '数据导出'
  var fs = wx.getFileSystemManager()
  var filePath = wx.env.USER_DATA_PATH + '/' + filename + '.xls'

  // ========== 构建 SpreadsheetML 2003 XML ==========
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += '<?mso-application progid="Excel.Sheet"?>\n'
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
  xml += ' xmlns:o="urn:schemas-microsoft-com:office:office"'
  xml += ' xmlns:x="urn:schemas-microsoft-com:office:excel"'
  xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"'
  xml += ' xmlns:html="http://www.w3.org/TR/REC-html40">\n'

  // 样式定义
  xml += '<Styles>\n'
  xml += '<Style ss:ID="Default"><Font ss:FontName="\u5B8B\u4F53" ss:Size="11"/><Alignment ss:Vertical="Center"/></Style>\n'
  xml += '<Style ss:ID="Header"><Font ss:FontName="\u5FAE\u8F6F\u96C5\u9ED1" ss:Size="11" ss:Bold="1" ss:Color="#1E293B"/><Interior ss:Color="#F0FDFA" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>' + _borderXml('#CCCCCC') + '</Style>\n'
  xml += '<Style ss:ID="DataText"><Font ss:FontName="\u5B8B\u4F53" ss:Size="11"/><Alignment ss:Vertical="Center"/>' + _borderXml('#E5E7EB') + '</Style>\n'
  xml += '<Style ss:ID="DataNum"><Font ss:FontName="\u5B8B\u4F53" ss:Size="11"/><NumberFormat ss:Format="General"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/>' + _borderXml('#E5E7EB') + '</Style>\n'
  xml += '</Styles>\n'

  // 每个集合一个 Worksheet
  for (var si = 0; si < sheets.length; si++) {
    var sheet = sheets[si]
    var headers = sheet.headers || []
    var rows = sheet.rows || []
    var colCount = headers.length || 1
    var sheetName = escapeXml(sheet.name || ('Sheet' + (si + 1)))
    // Sheet 名称最长 31 字符（Excel 限制）
    if (sheetName.length > 31) sheetName = sheetName.slice(0, 31)

    xml += '<Worksheet ss:Name="' + sheetName + '">\n'
    xml += '<Table>\n'

    // 表头行
    xml += '<Row ss:StyleID="Header">'
    for (var h = 0; h < colCount; h++) {
      xml += '<Cell><Data ss:Type="String">' + escapeXml(headers[h]) + '</Data></Cell>'
    }
    xml += '</Row>\n'

    // 数据行
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r]
      xml += '<Row>'
      for (var c = 0; c < colCount; c++) {
        var val = row[c]
        if (isNumeric(val)) {
          xml += '<Cell ss:StyleID="DataNum"><Data ss:Type="Number">' + escapeXml(val) + '</Data></Cell>'
        } else {
          xml += '<Cell ss:StyleID="DataText"><Data ss:Type="String">' + escapeXml(val != null ? val : '') + '</Data></Cell>'
        }
      }
      xml += '</Row>\n'
    }

    xml += '</Table>\n'
    xml += '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/></WorksheetOptions>\n'
    xml += '</Worksheet>\n'
  }

  xml += '</Workbook>'

  return new Promise(function (resolve, reject) {
    fs.writeFile({
      filePath: filePath,
      data: xml,
      encoding: 'utf-8',
      success: function () {
        wx.openDocument({
          filePath: filePath,
          fileType: 'xls',
          showMenu: true,
          success: function () {
            wx.showToast({ title: '\u5DF2\u6253\u5F00\uFF0C\u53EF\u5206\u4EAB\u4FDD\u5B58', icon: 'none', duration: 2500 })
            resolve()
          },
          fail: function (err) {
            console.error('openDocument fail:', err)
            wx.showToast({ title: '\u6587\u4EF6\u5DF2\u751F\u6210\uFF0C\u8BF7\u7528WPS\u6253\u5F00', icon: 'none', duration: 3000 })
            resolve()
          }
        })
      },
      fail: function (err) {
        console.error('writeFile fail:', err)
        wx.showToast({ title: '\u5BFC\u51FA\u5931\u8D25', icon: 'none' })
        reject(err)
      }
    })
  })
}

/**
 * 解析 Excel 文件（base64），返回二维数组（含表头行）
 * 云端模式走 excel 云函数（自动识别 xlsx/xls/csv）；本地模式 reject 由调用方兜底
 */
function parseExcelFile(base64) {
  if (!base64) return Promise.reject(new Error('文件内容为空'))
  if (USE_CLOUD && _cloudReady()) {
    return _callExcel('parseXlsx', { base64: base64 }).then(function (res) {
      return res.rows || []
    })
  }
  return Promise.reject(new Error('本地模式不支持云解析'))
}
