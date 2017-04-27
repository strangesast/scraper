import importFile from '../src/import';
import { Observable } from 'rxjs/Rx';
import { breakStreamIntoFullLines, streamIntoGen, chunk, breakLines } from '../src/parse';
import { readBlobStreamAsText, breakify, breakifyStream, streamObjectsFromURL, formatPercentage } from '../src/stream';
import { init, save } from '../src/save';

const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\r\nUt enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\r\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.\r\nExcepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\r\n';

describe('import function', () => {
  /*
  xit('should read file from url', async(finished) => {
    //let start = performance.now();

    let url = '/data/example.dmp';
    let { ids: saveResult, progress, objects } = streamObjectsFromURL(url);

    Observable.combineLatest(
      progress.map(formatPercentage),
      objects.mapTo(1).scan((a, b) => a+b, 0)
    ).sampleTime(100).subscribe(
      ([p, o]) => console.log(`${o} objects, ${p}`),
      (err) => console.error(err), () => console.log('complete')
    );

    finished();

  });

  xit('should read chunks from file', async(finished) => {
    //let url = '/data/Personnel_TemplatesFolder.dmp';
    let url = '/data/example.dmp';
    let request = new Request(url);
    let response = await fetch(request);

    let blob = await response.blob();

    let blobs = Observable.from(breakify(blob, 1e7));
    let reader = new FileReader();

    let progress = Observable.fromEvent(reader, 'progress');

    let loads = Observable.fromEvent(reader, 'load');

    let s = Observable.merge(progress, loads);

    blobs = blobs.share();

    let major = blobs.pluck('pos').map(pos => pos/blob.size)

    let minor = blobs.pluck('blob').concatMap(b => {
      let load = loads.take(1);
      reader.readAsText(b);
      return progress.takeUntil(load).merge(load).map(({ total, loaded }) => loaded/total);
    });

    major.merge(minor).subscribe(([a, b]) => console.log(a, b));


    finished();
  });
  */

  it('should break up text and read lines iteratively', (finished) => {
   
    // split string into groups of 10 characters
    let stream = Observable.from(chunk(text, 10));
    
    // reassemble full lines
    let arr = breakStreamIntoFullLines(stream).toArray().subscribe(arr => {
      // should be the same as splitting at returns
      expect(arr).toEqual(text.split('\r\n').slice(0, -1));

      finished();
   
    });
  });


  it('should decode a blob and pass it across a message channel', (finished) => {
    let channel = new MessageChannel();

    let maxConcurrency = 2;
    let { port1, port2 } = channel;

    //let g = breakStreamIntoFullLines(textStream, seperator) {

    // fakeWorker
    if (true) {
      let fakeWorkerMessages = Observable.fromEvent(port2, 'message').pluck('data');

      let [validFakeWorkerMessages, invalidFakeWorkerMessages] = fakeWorkerMessages
        .partition(({ id }) => id != null);

      invalidFakeWorkerMessages = invalidFakeWorkerMessages
        .map(message => ({ command: 'invalidMessage', message }));

      validFakeWorkerMessages.groupBy(({ id }) => id).map(messageStream => {
        let incomingBlobs = messageStream
          .filter(({ command }) => command === 'blob')
          .share();

        let readBlobs = readBlobStreamAsText(incomingBlobs.pluck('blob')).share();

        let foundLines = streamIntoGen(readBlobs, breakLines).filter(v => v.length)

        let foundObjectMessages = foundLines.map(lines => {
          return { command: 'blobLinesFound', lines };
        });

        let nextMessages = Observable.zip(incomingBlobs, readBlobs).map(([{ pos }]) => {
          let lastPos = pos;
          return { command: 'blobNext', lastPos };
        });

        let responseMessages = Observable.merge(nextMessages, foundObjectMessages);

        return responseMessages;

      }).mergeAll(maxConcurrency).merge(invalidFakeWorkerMessages).subscribe(message => {
        port2.postMessage(message);
      });

      port2.start();
    }

    // main
    if (true) {
      port1.start();

      let sample = text.repeat(1e5);
      let file = new Blob([sample], { type: 'text/plain' });

      let fileSize = file.size;
      let chunkSize = fileSize/100;
      let chunkCount = Math.ceil(fileSize/chunkSize);

      let responses = Observable.fromEvent(port1, 'message').pluck('data').share();

      let scheduler = responses.filter(({ command }) => command === 'blobNext');

      let fileId = 0;

      // break file into chunks, create message for each
      function* gen(file, chunkSize) {
        for (let { blob, pos } of breakify(file, chunkSize)) {
          port1.postMessage({ command: 'blob', blob, pos, id: fileId });
          yield pos;
        }
      }
    
      function validator(lastValue, response) {
        let { lastPos } = response;
        if (lastValue != lastPos) throw new Error('unexpected response');
      }

      let processing = breakifyStream(gen(file, chunkSize), scheduler, validator);

      let foundLines = responses.filter(({ command }) => command == 'blobLinesFound').pluck('lines');
      
      let lineCount = foundLines.map(a => a.length).scan((a, b) => a + b, 0);

      processing.withLatestFrom(lineCount).throttleTime(100).subscribe(
        ([p, n]) => console.log(formatPercentage(p/fileSize) + ' ' + n + ' lines'),
        console.error.bind(console),
        finished
      );

    }

  }, 10000);

  it ('should process at most n streams', (finished) => {
    const cardinal = ['one', 'two', 'three', 'four'];

    Observable.interval(100).take(4).map((i) => {
      return Observable.interval(100).map(j => [cardinal[i], j].join(', ')).take(5);
    })
    .mergeAll(2)
    .subscribe(console.log.bind(console), console.error.bind(console), () => finished);

  });
});
