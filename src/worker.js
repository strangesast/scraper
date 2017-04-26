require('jimp');
import { Observable } from 'rxjs/Rx';
import { setupBlobCommandStream, streamObjectsFromURL, formatPercentage } from './stream';
import { breakStreamIntoFullLines, parseLinesStream } from './parse';
const { Jimp } = self;

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

  let objects = withPhotos.merge(withoutPhotos);
  let objectFoundMessages = objects.map(object => ({ command: 'blobObjectFound', object, id }));

  let nextMessages = Observable.zip(input, textStream).map(([{ pos, length }, text]) => ({ command: 'blobNext', lastPos: pos, id }));

  let responseMessages = Observable.merge(nextMessages, objectFoundMessages);

  // feedback on invalid command
  let errorMessages = invalidBlobCommands
    .map(value => ({ error: 'invalid blob command', value, id }));
 
  return Observable.merge(responseMessages, errorMessages);

}).subscribe(message => {
  self.postMessage(message)
}, (err) => console.error(err));
