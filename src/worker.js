import { Observable } from 'rxjs';
import { streamObjectsFromURL, formatPercentage } from './stream';

let commandStream = Observable.fromEvent(self, 'message')
  .pluck('data').filter(x => x && typeof x.command === 'string');

let blobCommands = commandStream.filter(({ command }) => command.startsWith('blob'));

// break commands into groups of ids (allows for multiple blobs at once)
let eachBlobCommands = blobCommands.groupBy(({ id }) => id);

let eachBlobCommands.flatMap(commandStream => {
  // only two valid incomming commands atm
  let [validBlobCommands, invalidBlobCommands] = commandStream.partition(({ command }) => command === 'blob' || command === 'blobCancel');
  
  let input = validBlobCommands.filter(({ command }) => command === 'blob');

  let cancel = validBlobCommands.filter(({ command }) => command === 'blobCancel');

  let fileReader = new FileReader();

  input.concatMap(({ blob, pos, length }) => {
    let load = Observable.fromEvent(fileReader, 'load').take(1);
    fileReader.readAsText(blob);
    return load;
    
  }).takeUntil(cancel);





  // feedback on invalid command
  let errorMessages = invalidBlobCommands.map(value => ({ error: 'invalid blob command', value }));
 
  return errorMessages;
});


start.map(({ command, value }) => {
  switch (command) {
    case 'start':
      console.log('len', value.length);
      let { objects, progress } = streamObjectsFromURL(value);

      objects.mapTo(1).scan((a, b) => a+b, 0).withLatestFrom(progress).sampleTime(100).subscribe((o, i) => console.log(`${ o } objects, ${ formatPercentage(i) }`));
      return Observable.empty();
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
