import importFile from '../src/import';
import { Observable } from 'rxjs/Rx';

describe('import function', () => {
  it('should timeout', async(finished) => {
    //let start = performance.now();
    let url = '/data/example.dmp';
    let request = new Request(url);
    let response = await fetch(request);

    let readableStream = response.body;

    let stream = readify(readableStream)
      .concatMap(text => {
        let i = text.lastIndexOf('\n') + 1;
        return Observable.of(text.substring(0, i), text.substring(i));
      })
      .startWith('')
      .bufferCount(2)
      .map(pair => pair.join(''));

    let rows = stream.concatMap(string => Observable.from(splitify(string))).concat([null]);

    let root = rootParser();
    root.next();
    let subscription = rows.subscribe(row => {
      let done, value;
      ({ done, value } = root.next(row));

      if (done) {
        // should be an error if unexpected
        let largestPhotoObject = value.values.filter(f => f.object && f.object.PhotoFile).sort((a, b) => a.object.PhotoFile < a.object.PhotoFile)[0];
        if (largestPhotoObject) {
          window.open('data:image/jpg;base64,'+largestPhotoObject.object.PhotoFile);
        }
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
let keyRe = /(\w+)\s\:\s?(.*)?$/;

function* rootParser() {
  let line = yield;
  let res = null;
  let match;
  let headers = [];
  let values = [];
  while (line != null) {
    // header
    let match;
    if (match = headerRe.exec(line)) {
      let text = match[1];
      let keyMatch = keyRe.exec(text);
      if (keyMatch) {
        let [key, value] = keyMatch.slice(1);
        headers[key] = value;
      } else {
        headers.push(text);
      }

    } else if (match = keyRe.exec(line)) {
      let [key, value] = match.slice(1);
      switch (key) {
        case 'Dictionary':
          value = { dictionary: yield *dictionaryParser('NAME') };
          break;
        case 'Object':
          value = { object: yield *objectParser() };
          break;
        case 'Path':
          value = { path: value };
          break;
        default:
          console.error('unrecognized key', key);
      }
      values.push(value);
    }
    line = yield res;
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
    }
    line = yield;
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
          let [first, last] = value.split(',').map(s => s.trim());
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
    } // else do nothing / error
    line = yield;
  }
  return result;
}


function* photoFileParser() {
  let size = Number(yield);
  if (isNaN(size)) throw new Error('malformed PhotoFile');
  let line;
  let firstLine = line = yield;
  let len = firstLine.length;

  let string = line;
  do {
    line = yield;
    string+=line;

  } while (line.length == len) // should always be '80';

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
function* splitify(string, seperator='\n') {
  let size = string.length;
  let pos = 0;
  do {
    let i = string.indexOf(seperator, pos+1);
    i = i > -1 ? i : size;
    // may not want to trim
    yield string.substring(pos, i).trim();
    pos = i+1;
  } while (pos < size);
}
