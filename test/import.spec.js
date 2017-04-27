import importFile from '../src/import';
import { Observable } from 'rxjs/Rx';
import { breakStreamIntoFullLines, chunk, breakLines } from '../src/parse';
import { breakify, breakifyStream, streamObjectsFromURL, formatPercentage } from '../src/stream';
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
          .filter(({ command }) => command === 'blob');

        let fileReader = new FileReader();
        let readStream = Observable.fromEvent(fileReader, 'load').pluck('target', 'result');

        let readBlobs = incomingBlobs.concatMap(({ blob }) => {
          let read = readStream.take(1);
          fileReader.readAsText(blob);
          return read;
        }).share();

        let g = breakLines();
        g.next();
        let foundLines = readBlobs.map(text => {
          let { value, done } = g.next(text);
          if (done) throw new Error('premature completion');
          return value;
        }).finally(() => g.return()).filter(arr => arr && arr.length);

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

      let sample = text.repeat(1000);
      let file = new Blob([sample], { type: 'text/plain' });

      let fileSize = file.size;
      let chunkSize = 72;
      let chunkCount = Math.ceil(fileSize/chunkSize);

      let responses = Observable.fromEvent(port1, 'message').pluck('data');

      let scheduler = responses.filter(({ command }) => command === 'blobNext');

      let processing = breakifyStream(0, file, port1, scheduler, chunkSize).share();

      let foundLines = responses.filter(({ command }) => command == 'blobLinesFound').pluck('lines');
      
      let lineCount = foundLines.map(a => a.length).scan((a, b) => a + b, 0);

      processing.throttleTime(100).withLatestFrom(lineCount).subscribe(([p, n]) => console.log(formatPercentage(p/fileSize) + ' ' + n + ' lines'));

      processing.last().delay(1000).withLatestFrom(lineCount).subscribe(([_, n]) => {
        let justSplit = sample.split('\r\n');
        expect(n).toBe(justSplit.length - 1);
        finished();
      });
    }

  }, 10000);
});
