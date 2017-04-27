require('jimp');
import { Observable } from 'rxjs/Rx';
import { readBlobStreamAsText, setupBlobCommandStream, streamObjectsFromURL, formatPercentage } from './stream';
import { streamIntoGen, breakLines, breakStreamIntoFullLines, parseLinesStream, parseRoot } from './parse';
const { Jimp } = self;

let eachBlobCommands = setupBlobCommandStream(self);

eachBlobCommands.flatMap(commandStream => {
  let id = commandStream.key;
  // only two valid incomming commands atm
  let [validBlobCommands, invalidBlobCommands] = commandStream
    .partition(({ command }) => command === 'blob' || command === 'blobCancel');
  
  let input = validBlobCommands
    .filter(({ command }) => command === 'blob')
    .takeWhile(({ done }) => !done)

  let cancel = validBlobCommands
    .filter(({ command }) => command === 'blobCancel');

  let textStream = readBlobStreamAsText(input);

  let g = breakLines();
  g.next('');

  let parser = parseRoot(true);
  parser.next('');

  let test = textStream.map(({ text, pos }) => {
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
    parser.return();
  });

  /*
  let [withPhotos, withoutPhotos] = parsed.filter(x => x && x.object).pluck('object').partition(x => x.PhotoFile);
  withPhotos = withPhotos.flatMap(obj => {
    let read = Observable.fromPromise(Jimp.read(obj.PhotoFile));
    
    return read.flatMap(image => {
      let { width, height } = image.bitmap;
      let min = Math.min(width, height);
      let maxDim = 200;
      let size = Math.min(min, maxDim);
      let dx = (width - min)/2;
      let dy = (height - min)/2;
      let fn = Observable.bindCallback(image.crop(dx, dy, min, min).resize(size, size).getBase64.bind(image));
      return fn(Jimp.AUTO).map(([_, url]) => {
        obj.PhotoFile = url;
        return obj;
      });
    }).catch((err) => {
      console.error(err);
      return Observable.of(obj)
    });
  });
  */

  let nextMessages = test.map(lastPos => {
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
