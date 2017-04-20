import { Observable } from 'rxjs';
import { init, save } from './save';
import { parseStream, shrinkCropPhoto } from './parse';

export function streamObjectsFromURL(url, updateInterval) {
  let { stream, progress } = streamRequest(new Request(url), updateInterval);

  return Object.assign(parseSaveStream(stream), { progress });
}


export function streamObjectsFromBlob(blob) {
  /*
  let size = blob.size;
  let blobStream = Observable.from(breakify(blob, incr)).share();

  let progress = blobStream.pluck('pos').map(pos => Math.min(pos/size, 1));

  let stream = blobStream.pluck('blob').do(x => console.log(x));

  return Object.assign(parseSaveStream(stream), { progress });
  */
  let url = URL.createObjectURL(blob);
  return streamObjectsFromURL(url);
}


export function parseSaveStream(stream) {
  let parsed = parseStream(stream);
  let objects = parsed.filter(x => x && x.object).pluck('object').share();

  /*
  let [withPhotos, withoutPhotos] = objects.partition(x => !!x.PhotoFile);

  let cleaned = Observable.zip(withPhotos, shrinkCropPhoto(withPhotos.pluck('PhotoFile'))).map(([ob, data]) => {
    ob.PhotoFile = data;
    return ob;
  });
  */

  return { objects };

  // stream of saved ids
  let ids = init('scraper', 1, [{ name: 'dump', keyPath: 'id', autoIncrement: true }], true).flatMap(db => {
    // accumulate objects for indexeddb storage
    //let groups = Observable.merge(cleaned, withoutPhotos).map(data => {
    let groups = objects.map(data => {
      return { data };
    }).bufferTime(1000).filter(x => x.length > 0);

    return groups.concatMap(group => {
      return save(db, 'dump', group);
    });

  });

  return { ids, objects }; // { objects: cleaned }

}


export function streamRequest(request, updateInterval=100) {
  // use fetch for net. request
  let response = Observable.fromPromise(fetch(request));

  // content-length TODO: handle missing header
  let length = response.map(res => res.headers.get('content-length'));

  // response.body
  let readableStream = response.pluck('body');

  // use readify to chunk response stream
  let bytes = readableStream.concatMap(s => readify(s)).share();

  // current position in response, fraction
  let clength = bytes.scan((tot, string) => tot + string.length, 0);
  let progress = length.combineLatest(clength.sampleTime(updateInterval)).map(([a, b]) => b/a).concat(Observable.of(1));

  // split up stream into whole lines of response
  let stream = bytes
    .concatMap(text => {
      let i = text.lastIndexOf('\n') + 1;
      return Observable.of(text.substring(0, i), text.substring(i));
    })
    .startWith('')
    .bufferCount(2)
    .map(pair => pair.join(''));

  return { progress, stream };
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


export function* breakify(blob, incr=1e5) {
  let size = blob.size;
  let pos = 0;
  do {
    yield ({ blob: blob.slice(pos, pos+=incr), pos });
  } while (pos < size);
}


export function formatBytes(bytes,decimals) {
  if(bytes == 0) return '0 Bytes';
  var k = 1000,
  dm = decimals + 1 || 3,
  sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
  i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


export function formatPercentage(p) {
  return `${ (Math.floor(p*1e6)/1e4).toFixed(4) }%`;
}
