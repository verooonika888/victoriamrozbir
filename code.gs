function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var rawData = e.postData.contents;
    var data = null;
    try {
      if (rawData) {
        data = JSON.parse(rawData);
      }
    } catch (parseError) {
      // Possible fallback parsing if needed, but WFP uses JSON
    }

    // Если это callback от WayForPay, в нем есть orderReference и transactionStatus
    if (data && data.orderReference && data.transactionStatus) {
      return handleWayForPayCallback(data);
    } 
    // Иначе это 1-ый шаг: отправка формы из лендинга
    else {
      return handleFormSubmit(data || {});
    }
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function handleFormSubmit(data) {
  var targetSheetName = data.sheetName || data.target_sheet || 'Ленд 3'; 
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(targetSheetName);
  var defaultHeaders = ['Date', 'Name', 'Phone', 'Social', 'Niche', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'Order ID', 'Price', 'Status'];
  
  if (!sheet) {
    sheet = ss.insertSheet(targetSheetName);
    sheet.appendRow(defaultHeaders);
  }
  
  var timestamp = Utilities.formatDate(new Date(), "GMT+2", "dd.MM.yyyy HH:mm:ss");
  
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
      sheet.appendRow(defaultHeaders);
      lastCol = defaultHeaders.length;
  }
  
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  
  var ensureHeader = function(name) {
    var idx = headers.indexOf(name);
    if (idx === -1) {
      sheet.getRange(1, headers.length + 1).setValue(name);
      headers.push(name);
      return headers.length - 1;
    }
    return idx;
  };

  var colDate = ensureHeader('Date');
  var colOrderId = ensureHeader('Order ID');
  var colName = ensureHeader('Name');
  var colPhone = ensureHeader('Phone');
  var colSocial = ensureHeader('Social');
  var colNiche = ensureHeader('Niche');
  var colPrice = ensureHeader('Price');
  var colStatus = ensureHeader('Status');
  var colUtmSource = ensureHeader('UTM Source');
  var colUtmMedium = ensureHeader('UTM Medium');
  var colUtmCampaign = ensureHeader('UTM Campaign');
  
  var rowData = new Array(headers.length).fill('');
  rowData[colDate] = timestamp;
  rowData[colOrderId] = data.orderId || '';
  rowData[colName] = data.name || '';
  rowData[colPhone] = data.phone ? "'" + data.phone : '';
  rowData[colSocial] = data.social || '';
  rowData[colNiche] = data.niche || '';
  rowData[colPrice] = data.amount || '';
  rowData[colStatus] = data.status || 'Новий лід (Не оплачено)';
  rowData[colUtmSource] = data.utm_source || '';
  rowData[colUtmMedium] = data.utm_medium || '';
  rowData[colUtmCampaign] = data.utm_campaign || '';

  sheet.appendRow(rowData);
  
  return ContentService.createTextOutput(JSON.stringify({ 'result': 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleWayForPayCallback(data) {
  const SECRET_KEY = '17addcd05644675231e2fe92b9328a7641dd7553';
  var orderId = data.orderReference;
  var status = data.transactionStatus; 
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var found = false;

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;
    
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var orderIdColIdx = headers.indexOf('Order ID');
    var statusColIdx = headers.indexOf('Status');
    
    if (orderIdColIdx === -1 || statusColIdx === -1) continue;
    
    var orderIdValues = sheet.getRange(2, orderIdColIdx + 1, lastRow - 1, 1).getValues();
    
    for (var r = 0; r < orderIdValues.length; r++) {
      if (orderIdValues[r][0] === orderId || String(orderIdValues[r][0]) === String(orderId)) { 
        if (status === 'Approved') {
          sheet.getRange(r + 2, statusColIdx + 1).setValue('Оплачено');
        } else {
          sheet.getRange(r + 2, statusColIdx + 1).setValue('Помилка оплати (' + status + ')');
        }
        found = true;
        break;
      }
    }
    if (found) break; // Break from outer loop if found
  }

  var time = Math.round(new Date().getTime() / 1000);
  var signatureBody = data.orderReference + ';accept;' + time;
  var signatureBytes = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_MD5, signatureBody, SECRET_KEY);
  
  var signatureHex = signatureBytes.map(function(byte) {
      return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
  
  var responsePayload = {
    orderReference: data.orderReference,
    status: 'accept',
    time: time,
    signature: signatureHex
  };

  return ContentService.createTextOutput(JSON.stringify(responsePayload))
    .setMimeType(ContentService.MimeType.JSON);
}