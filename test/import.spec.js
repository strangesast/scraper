import importFile from '../src/import';
import { Observable } from 'rxjs/Rx';

function formatBytes(bytes,decimals) {
  if(bytes == 0) return '0 Bytes';
  var k = 1000,
  dm = decimals + 1 || 3,
  sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
  i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function print(rows, p) {
  console.log(`${ rows } rows, ${ (Math.floor(p*10000)/100).toFixed(2) }%`)
};
describe('import function', () => {
  it('should timeout', async(finished) => {
    //let start = performance.now();
    let url = '/data/example.dmp';
    let request = new Request(url);
    let response = await fetch(request);
    let contentLength = Number(response.headers.get('content-length'));

    console.log(formatBytes(contentLength));

    let readableStream = response.body;

    let j = 0;

    let stream = readify(readableStream)
      .do(x => j+=x.length)
      .concatMap(text => {
        let i = text.lastIndexOf('\n') + 1;
        return Observable.of(text.substring(0, i), text.substring(i));
      })
      .startWith('')
      .bufferCount(2)
      .map(pair => pair.join(''));

    let i = 0;
    let rows = stream.concatMap(string => Observable.from(splitify(string))).do(x => i++).concat([null]);

    let counter = setInterval(() => print(i, j/contentLength), 1000);

    let root = rootParser();
    root.next();

    let dict;
    let remaining;
    let win;
    let props = [];


    let subscription = rows.subscribe(row => {
      let done, value;
      ({ done, value } = root.next(row));

      if( value && value.dictionary ) {
        dict = value.dictionary;
        remaining = Object.keys(dict);
      }

      if (value && value.object && remaining) {
        for (let key of Object.keys(value.object)) {
          if (props.indexOf(key) == -1) {
            props.push(key);
          }
        }
      }

      /*
      if (value && value.object && value.object.PhotoFile && value.object.PhotoFile.length > 1e4) {
        if (win) {
          win.close();
        }
        win = window.open('data:image/jpg;base64,'+value.object.PhotoFile);
      }
      */

      if (done) {
        print(i, j/contentLength);
        console.log('cleared');
        console.log(props);
        clearInterval(counter);
        // should be an error if unexpected
        /*
        let largestPhotoObjects = value.values.filter(f => f.object && f.object.PhotoFile).map(f => f.object.PhotoFile).sort((a, b) => a.length > b.length ? -1 : 1).slice(0, 4);
        if (largestPhotoObjects.length) {
          for (let PhotoFile of largestPhotoObjects) {
            window.open('data:image/jpg;base64,'+PhotoFile);
          }
        }
        */
        subscription.unsubscribe();
      }
    });

    //rows.count().subscribe((l) => console.log('lines', l), null, () => console.log(performance.now() - start));

    // root
    //   Path, Dictionary, EndDictionary, Object, EndObject
    
    // Dictionary
    
    // Object
    //   Type, LastChange, Owner, RefTemplate, Alias, CreateTime, etc
    //   AreaLinks, EndAreaLinks
    //   PhotoFile

    finished();

  }, 30000);
});

let headerRe = /^\'\s*(.+)?$/;
let keyRe = /^\s*(\w+)\s\:\s?(.*)?$/;

function* rootParser() {
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
          let dictionary = yield *dictionaryParser('NAME');
          value = { dictionary };
          break;
        case 'Object':
          let object = yield *objectParser();
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


function* dictionaryParser(keyName) {
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


function parseRow(string) {
  return string.trim().split(':').map(s => s.trim());
}


function* objectParser() {
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
          value = yield* areaLinksParser();
          break;
        case 'PhotoFile':
          value = yield* photoFileParser();
          break;
      }
      result[key] = value;
      line = yield value;
    } // else do nothing / error
    line = yield null;
  }
  return result;
}


function* photoFileParser() {
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

function* areaLinksParser() {
  let line = yield;
  return [];
}


function readify(readableStream) {
  return Observable.create(observer => {
    let reader = readableStream.getReader();
    let decoder = new TextDecoder();
    let canceled = false;

    function fn() {
      reader.read().then(({ done, value }) => {
        if (canceled) {
          return;
        } else if (!done) {
          observer.next(decoder.decode(value, { stream: true }));
          fn();
        } else {
          observer.complete();
        }
      });
    };
    fn();

    // return cancel function
    return () => {
      canceled = true;
      reader.cancel('Subscription canceled');
    };
  });
}

function* breakify(string, length=2) {
  let pos = 0;
  do {
    yield string.substring(pos, pos+=length);
  } while (pos < string.length);
}

// better than split
function* splitify(string, seperator='\r\n') {
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
