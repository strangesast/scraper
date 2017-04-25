import { Observable } from 'rxjs/Rx';
import { setupBlobCommandStream, streamObjectsFromURL, formatPercentage } from './stream';
import { breakStreamIntoFullLines, parseLinesStream } from './parse';

let eachBlobCommands = setupBlobCommandStream(self);

eachBlobCommands.flatMap(commandStream => {
  let id = commandStream.key;
  // only two valid incomming commands atm
  let [validBlobCommands, invalidBlobCommands] = commandStream
    .partition(({ command }) => command === 'blob' || command === 'blobCancel');
  
  let input = validBlobCommands
    //.do(x => console.log('received message:', x))
    .filter(({ command }) => command === 'blob')
    .share();

  let cancel = validBlobCommands
    .filter(({ command }) => command === 'blobCancel');

  let fileReader = new FileReader();
  let loads = Observable.fromEvent(fileReader, 'load').pluck('target', 'result');

  let textStream = input
    .concatMap(({ blob, pos, length }) => {
      //console.log(`reading blob as text (${ pos/length })`)
      let load = loads.take(1);
      fileReader.readAsText(blob);
      return load;
    })
    .takeUntil(cancel)
    .share();

  let linesStream = breakStreamIntoFullLines(textStream);
  let parsed = parseLinesStream(linesStream);
  let objects = parsed.filter(x => x && x.object).pluck('object');
  let objectFoundMessages = objects.map(object => ({ command: 'blobObjectFound', object, id }));

  let nextMessages = Observable.zip(input, textStream).map(([{ pos, length }, text]) => ({ command: 'blobNext', lastPos: pos, id }));

  let responseMessages = Observable.merge(nextMessages, objectFoundMessages);

  // feedback on invalid command
  let errorMessages = invalidBlobCommands
    .map(value => ({ error: 'invalid blob command', value, id }));
 
  return Observable.merge(responseMessages, errorMessages);

}).subscribe(message => {
  //console.log('sending', message);
  self.postMessage(message)
}, (err) => console.error(err));
