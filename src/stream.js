import { Observable } from 'rxjs';


export function streamRequest(request, minInterval=100, formatted=true) {
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
  let progress = length.combineLatest(clength.throttleTime(minInterval)).map(([a, b]) => b/a);
  if (formatted) {
    progress = progress.map(formatPercentage);
  }

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

function formatBytes(bytes,decimals) {
  if(bytes == 0) return '0 Bytes';
  var k = 1000,
  dm = decimals + 1 || 3,
  sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
  i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatPercentage(p) {
  return `${ (Math.floor(p*10000)/100).toFixed(2) }%`;
}
