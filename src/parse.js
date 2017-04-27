import { Observable } from 'rxjs/Rx';

const headerRe = /^\'\s*(.+)?$/;
const keyRe = /^\s*(\w+)\s\:\s?(.*)?$/;


export function parseStream(stream) {
  // check out Observable.wrap
  let root = parseRoot(true);
  root.next();
  return stream
    .concatMap(string => Observable.from(splitify(string)))
    .concat([null])
    .map(row => root.next(row)).pluck('value');
}


export function parseLinesStream(stream) {
  let root = parseRoot(true);
  root.next();
  return stream
    .map(line => root.next(line))
    .finally(() => root.return())
    .pluck('value');
}


export function* breakLines(seperator='\r\n') {
  let res, buf = '', i;
  while (true) {
    buf += yield res;
    i = buf.lastIndexOf(seperator);
    if (i > -1) {
      res = buf.substring(0, i).split(seperator);
      buf = buf.substring(i+seperator.length);
    } else {
      res = [];
    }
  }
};


export function streamIntoGen(stream, gen, ignoreNull=true) {
  let g = gen();
  g.next();
  let ret = stream.map(val => {
    let { value, done } = g.next(val);
    if (done) throw new Error('gen completed before stream');
    return value;
  }).finally(() => g.return());
  if (ignoreNull) {
    ret = ret.filter(val => val != null);
  }
  return ret;
}


export function breakStreamIntoFullLines(textStream, seperator) {
  return streamIntoGen(textStream, breakLines.bind(null, seperator)).filter(lines => {
    return lines.length;
  }).concatMap(lines => Observable.from(lines));
}

const keyNames = {
  address:     'Address',
  building:    'Building',
  city:        'City',
  department:  'Department',
  download:    'Download',
  email:       'Email Address',
  embossed:    'Embossed Number',
  external:    'External System ID',
  first:       'First Name',
  interal:     'Internal Number',
  last:        'Last Name',
  load:        'Load Date',
  middle:      'Middle Name',
  partition:   'Partition',
  phone:       'Phone',
  roles:       'Roles',
  state:       'State',
  status:      'Status',
  title:       'Title',
  tokenStatus: 'Token Status',
  token:       'Token Unique',
  phone:       'Work Phone',
  zip:         'Zip'
};

function transformObjectKeys(object) {
  let obj = {};
  for (let key in object) {
    switch (key) {
      case 'AreaLinks':
        obj[key] = object[key];
        break;
      case 'PhotoFile':
        obj[key] = object[key];
        break;
      case 'CardNumber2':
        if (obj[keyNames.embossed]) break;
      case 'CardNumber':
        obj[keyNames.embossed] = object[key];
        obj[keyNames.interal]  = object[key];
        obj[keyNames.token]   = object[key];
        break;
      case 'Department':
        obj[keyNames.department] = object[key];
        break;
      case 'FirstName':
        obj[keyNames.first] = object[key];
        break;
      case 'LastName':
        obj[keyNames.last] = object[key];
        break;
      case 'FullName':
        let { first, last } = object[key];
        if (first) {
          obj[keyNames.first] = first;
        }
        if (last) {
          obj[keyNames.last] = last;
        }
        break;
      case 'MiddleName':
        obj[keyNames.middle] = object[key];
        break;
      case 'JobTitle':
        obj[keyNames.title] = object[key];
        break;
      case 'OfficeLocation':
        obj[keyNames.building] = object[key];
        break;
      case 'State':
        let s = +object[key];
        if (isNaN(s) || (s != 0 && s != 1)) {
          obj[keyNames.status] = obj[keyNames.tokenStatus] = s = null; // could be improved
        } else {
          obj[keyNames.status] = s;
          obj[keyNames.tokenStatus] = s == 1 ? 1 : 2;
          obj[keyNames.download] = s == 1 ? 't' : 'f';
        }
        break;
      case 'WorkPhone':
        obj[keyNames.phone] = object[key];
        break;
      //case 'ActivationDate':
      //case 'Alias':
      //case 'BlobTemplate':
      //case 'CardType':
      //case 'CreatedBy':
      //case 'CreateTime':
      //case 'FipsPersonId':
      //case 'Info1':
      //case 'InstanceId':
      //case 'LastChange':
      //case 'LastChangedBy':
      //case 'Object':
      //case 'Owner':
      //case 'RefTemplate':
      //case 'SiteCode':
      //case 'StartDate':
      //case 'TimeLocked':
      //case 'Type':
      //case 'Visitor':
    }
  }
  return obj;
}


export function* parseRoot(includePhotos=false) {
  let line = yield;
  let res = null;
  let match;
  let headers = [];
  //let values = [];
  try {
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
            let object = yield *parseObject(includePhotos);
            object = transformObjectKeys(object);
            value = { object };
            break;
          case 'Path':
            value = { path: value };
            break;
          default:
            throw new Error('unrecognized key', key);
        }
        //values.push(value);
      }
      line = yield value;
    }
  } finally {
  }
  //return { values, headers };
}


export function* parseDictionary(keyName) {
  let line = yield;
  let header;
  let result = [];
  let keyIndex;
  try {
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
  } finally {
    return result;
  }
}


export function parseRow(string) {
  let i = string.lastIndexOf(';0');
  if (i > -1) string = string.substring(0, i);
  return string.trim().split(/\s:\s/).map(s => s.trim());
}


export function* parseObject(includePhotos=false) {
  let line = yield;
  let header;
  let match;
  let result = {};
  try {
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
            value = yield* (includePhotos ? parsePhotoFile : skipPhotoFile)();
            break;
        }
        result[key] = value;
        line = yield value;
      } // else do nothing / error
      line = yield null;
    }
  } finally {
    return result;
  }
}


export function* parsePhotoFile() {
  let size = Number(yield);
  if (isNaN(size)) throw new Error('malformed PhotoFile');
  let line;
  let firstLine = line = yield;
  let len = firstLine.length;

  let string = line.trim();
  try {
    do {
      line = yield;
      string+=line.trim();

    } while (line.length == len) // should always be '82';
  } finally {}

  let buf = null;
  if (string.length > 1e4) {
    try {
      buf = 'data:image/png;base64,' + new Buffer(string, 'hex').toString('base64');
    } catch (e) {}
  }
  return buf;
}


export function* skipPhotoFile() {
  let size = Number(yield);
  let line;
  let firstLine = line = yield;
  let len = firstLine.length;
  try {
    do {
      line = yield;
    } while (line.length == len) // should always be '82';
  } finally {
    return null;
  }
}

function areaLinksComparer(a, b) {
  let r = 0;
  for (let i=0; i < a.length; i++) {
    r = a[i] < b[i] ? -1 : a[i] > b[i] ? 1 : 0;
    if (r != 0) break;
  }
  return r;
};

export function* parseAreaLinks() {
  let line = yield;
  let links = [];
  try {
    while (!/^\s*EndAreaLinks$/.test(line)) {
      //links.push(line);
      links.push(parseRow(line));
      line = yield;
    }
  } finally {}
  return links.sort(areaLinksComparer);
}

// for testing
export function* chunk(text, incr=10) {
  let pos = 0;
  do {
    yield text.substring(pos, pos+=incr);
  } while (pos < text.length);
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
