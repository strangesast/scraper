import { Observable } from 'rxjs';
import { streamObjectsFromURL } from './stream';

let commandStream = Observable.fromEvent(self, 'message')
  .pluck('data').filter(x => x && x.command);

commandStream.map(({ command, value }) => {
  switch (command) {
    case 'start':
      let { objects, progress } = streamObjectsFromURL(value);
      return progress.concat(Observable.of(null));
      //return Observable.interval(10).mapTo('toast').take(10).concat(Observable.of(null));

    case 'test':
      return Observable.of('toast').delay(1000);

    default:
      return Observable.empty();
  }
}).exhaust()
  .subscribe(result => {
    self.postMessage({ result });
  }, (err) => {
    console.error(err);
  });
