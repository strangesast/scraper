import { Observable } from 'rxjs';
let headerRe = /^\'\s*(.+)?$/;
let keyRe = /^\s*(\w+)\s\:\s?(.*)?$/;


export function parseStream(stream) {
  let root = parseRoot();
  root.next();
  return stream
    .concatMap(string => Observable.from(splitify(string)))
    .concat([null])
    .map(row => root.next(row)).pluck('value');
}

export function* parseRoot() {
  let line = yield;
  let res = null;
  let match;
  let headers = [];
  let values = [];
  while (line != null) {
    // header
    let key, value, match;
    if (match = headerRe.exec(line)) {
      value = match[1];
      let keyMatch = keyRe.exec(value);
      if (keyMatch) {
        [key, value] = keyMatch.slice(1);
        headers[key] = value;
      } else {
        headers.push(value);
      }

    } else if (match = keyRe.exec(line)) {
      [key, value] = match.slice(1);
      switch (key) {
        case 'Dictionary':
          let dictionary = yield *parseDictionary('NAME');
          value = { dictionary };
          break;
        case 'Object':
          let object = yield *parseObject();
          value = { object };
          break;
        case 'Path':
          value = { path: value };
          break;
        default:
          console.error('unrecognized key', key);
      }
      values.push(value);
    }
    line = yield value;
  }
  return { values, headers };
}


export function* parseDictionary(keyName) {
  let line = yield;
  let header;
  let result = [];
  let keyIndex;
  while (!/^EndDictionary$/.test(line)) {
    if (!header) {
      if (line.startsWith('\'')) {
        header = parseRow(line.substring(1));
        if (keyName) {
          keyIndex = header.indexOf(keyName);
          if (keyIndex == -1) throw new Error('incompatible dict key');
        }
      }
      line = yield { header };
    } else {
      let row = parseRow(line);
      let obj = row.reduce((res, field, i) => {
        res[header[i]] = field;
        return res
      }, {});
      if (keyName) {
        let key = header[keyIndex];
        result[obj[header[keyIndex]]] = obj;
      } else {
        result.push(obj);
      }
      line = yield obj;
    }
  }
  return result;
}


export function parseRow(string) {
  return string.trim().split(':').map(s => s.trim());
}


export function* parseObject() {
  let line = yield;
  let header;
  let match;
  let result = {};
  while (!/^EndObject$/.test(line)) {
    if (match = keyRe.exec(line)) {
      let [key, value] = match.slice(1);
      switch (key) {
        // text
        case 'Type':
        case 'Owner':
        case 'RefTemplate':
        case 'Alias':
        case 'CreatedBy':
        case 'InstanceId':
        case 'CardType':
        case 'SiteCode':
        case 'CardNumber':
        case 'CardNumber2':
        case 'Department':
        case 'FirstName':
        case 'JobTitle':
        case 'OfficeLocation':
        case 'FipsPersonId':
        case 'BlobTemplate':
          break;
        case 'FullName':
          let [last, first] = value.split(',').map(s => s.trim());
          value = { first, last };
          break;
        // dates
        case 'ActivationDate':
        case 'CreateTime':
        case 'LastChange':
        case 'StartDate':
        case 'TimeLocked':
          value = new Date(value);
          break;
        case 'AreaLinks':
          value = yield* parseAreaLinks();
          break;
        case 'PhotoFile':
          value = yield* parsePhotoFile();
          break;
      }
      result[key] = value;
      line = yield value;
    } // else do nothing / error
    line = yield null;
  }
  return result;
}


export function* parsePhotoFile() {
  let size = Number(yield);
  if (isNaN(size)) throw new Error('malformed PhotoFile');
  let line;
  let firstLine = line = yield;
  let len = firstLine.length;

  let string = line.trim();
  do {
    line = yield;
    string+=line.trim();

  } while (line.length == len) // should always be '82';

  return new Buffer(string, 'hex').toString('base64');
}


export function* parseAreaLinks() {
  let line = yield;
  return [];
}

// better than split
export function* splitify(string, seperator='\r\n') {
  let size = string.length;
  let pos = 0;
  do {
    let i = string.indexOf(seperator, pos);
    if (i == -1) {
      yield string.substring(pos);
    } else if (i > 0) {
      yield string.substring(pos, i);
    }
    pos = i+seperator.length;
  } while (pos < size);
}


export function shrinkCropPhoto(stream, minSize=1e4, maxDim=180) {
  let image = new Image();
  let canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');

  return stream.concatMap(data => {
    if (!data) {
      return Observable.of(null);
    } if (data.length < minSize) {
      return Observable.of('data:image/png;base64,' + data);
    }

    let load = Observable.fromEvent(image, 'load').take(1);
    image.src = 'data:image/png;base64,' + data;

    return load.map(() => {
      let [width, height] = [image.width, image.height];
      let min = Math.min(width, height);
      let size = Math.min(min, maxDim);
      let dx = (width - min)/2;
      let dy = (height - min)/2;
      canvas.width = canvas.height = size;
      ctx.drawImage(image, dx, dy, min, min, 0, 0, size, size);
      let dataURL = canvas.toDataURL();
      return dataURL;
    });
  });
};
