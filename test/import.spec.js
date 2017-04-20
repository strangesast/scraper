import importFile from '../src/import';
import { Observable } from 'rxjs';
import { streamObjectsFromURL, formatPercentage } from '../src/stream';
import { init, save } from '../src/save';


describe('import function', () => {
  it('should timeout', async(finished) => {
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

  }, 30000);
});
