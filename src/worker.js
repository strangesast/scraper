require('jimp');
import { Observable } from 'rxjs/Rx';
import { readBlobStreamAsText, setupBlobCommandStream, streamObjectsFromURL, formatPercentage } from './stream';
import { streamIntoGen, breakLines, breakStreamIntoFullLines, parseLinesStream, parseRoot } from './parse';
const { Jimp } = self;

let commandStream = Observable.fromEvent(self, 'message')
  .pluck('data').filter(x => x && typeof x.command === 'string');

let blobCommands = commandStream
  .filter(({ command }) => command.startsWith('blob'));

// break commands into groups of ids (allows for multiple blobs at once)
let eachBlobCommands = blobCommands.groupBy(({ id }) => id);

eachBlobCommands.flatMap(stream => {
  let id = stream.key;
  // only two valid incomming commands atm
  let [validBlobCommands, invalidBlobCommands] = stream
    .partition(({ command }) => command === 'blob' || command === 'blobCancel');
  
  let parser;
  let input = validBlobCommands
    .filter(({ command }) => command === 'blob')
    .takeWhile(({ done }) => !done)

  let cancel = validBlobCommands
    .filter(({ command }) => command === 'blobCancel');

  let g = breakLines();
  g.next('');

  let textStream = readBlobStreamAsText(input.take(1).concatMap(message => {
    let { includePhotos } = message;
    parser = parseRoot(!!includePhotos);
    parser.next('');
    return Observable.of(message).concat(input)
      .finally(() => parser.return()); // this doesn't actually work
  }));
  //let textStream = readBlobStreamAsText(test);

  let parseText = textStream.map(({ text, pos }) => {
    let { value: lines, done } = g.next(text);

    let objects = [];
    for (let line of lines) {
      let { value, done } = parser.next(line);
      if (value && value.object) {
        objects.push(value.object);
      }
    }

    if (objects.length) {
      self.postMessage({ command: 'blobObjectsFound', objects, id });
    }

    return pos;
  }).finally(() => {
    g.return();
  });

  let nextMessages = parseText.map(lastPos => {
    return { command: 'blobNext', lastPos, id };
  });

  let responseMessages = nextMessages;//Observable.merge(nextMessages, objectsFoundMessages);

  // feedback on invalid command
  let errorMessages = invalidBlobCommands
    .map(value => ({ error: 'invalid blob command', value, id }));
 
  return Observable.merge(responseMessages, errorMessages);

}).subscribe(message => {
  self.postMessage(message)
}, console.error.bind(console));


commandStream.filter(({ command }) => command.startsWith('photo')).flatMap(({ photo, id }) => {
  let read = Observable.fromPromise(Jimp.read(photo));
  
  let command = 'photoNext';

  return read.flatMap(image => {
    let { width, height } = image.bitmap;
    let min = Math.min(width, height);
    let maxDim = 200;
    let size = Math.min(min, maxDim);
    let dx = (width - min)/2;
    let dy = (height - min)/2;
    let fn = Observable.bindCallback(image.crop(dx, dy, min, min).resize(size, size).getBase64.bind(image));
    return fn(Jimp.AUTO).map(([_, url]) => {
      return { command, id, url };
    });
  });
}).subscribe(message => self.postMessage(message));
