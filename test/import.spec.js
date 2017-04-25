import importFile from '../src/import';
import { Observable } from 'rxjs';
import { breakStreamIntoFullLines, chunk } from '../src/parse';
import { breakify, streamObjectsFromURL, formatPercentage } from '../src/stream';
import { init, save } from '../src/save';


describe('import function', () => {
  xit('should read file from url', async(finished) => {
    //let start = performance.now();

    let url = '/data/example.dmp';
    let { ids: saveResult, progress, objects } = streamObjectsFromURL(url);

    Observable.combineLatest(
      progress.map(formatPercentage),
      objects.mapTo(1).scan((a, b) => a+b, 0)
    ).sampleTime(100).subscribe(
      ([p, o]) => console.log(`${o} objects, ${p}`),
      (err) => console.error(err),
      () => console.log('complete')
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


  it('should break up text and read lines iteratively', async(finished) => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\r\nUt enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\r\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.\r\nExcepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
   
    // split string into groups of 10 characters
    let stream = Observable.from(chunk(text, 10));
    
    // reassemble full lines
    let arr = await breakStreamIntoFullLines(stream).toArray().toPromise();

    // should be the same as splitting at returns
    expect(arr).toEqual(text.split('\r\n').slice(0, -1));

    finished();
  });

});
