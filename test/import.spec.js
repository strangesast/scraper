import importFile from '../src/import';
import { Observable } from 'rxjs';
import { parseStream } from '../src/parse';
import { streamRequest } from '../src/stream';


describe('import function', () => {
  it('should timeout', async(finished) => {
    //let start = performance.now();

    let url = '/data/example.dmp';
    let { stream, progress } = streamRequest(new Request(url));

    progress.subscribe((p) => console.log(p));

    let win;
    let props = [];

    //let [withImage, withoutImage] = parseStream(stream).partition(value => value && value.object && value.object.PhotoFile);
    let parsed = parseStream(stream);


    let subscription = parsed.subscribe(value => {
    //let subscription = parseStream(stream).subscribe(value => {

    //let subscription = Observable.merge(withImage, withoutImage).subscribe( value => {
      // Get unique props on object
      /*
      if (value && value.object && remaining) {
        for (let key of Object.keys(value.object)) {
          if (props.indexOf(key) == -1) {
            props.push(key);
          }
        }
      }
      */

      // print images
      /*
      if (value && value.object && value.object.PhotoFile && value.object.PhotoFile.length > 1e4) {
        if (win) {
          win.close();
        }
        win = window.open('data:image/jpg;base64,'+value.object.PhotoFile);
      }
      */

    }, null, () => {
      console.log('finished');
      console.log(props);
      /*
      let largestPhotoObjects = value.values.filter(f => f.object && f.object.PhotoFile).map(f => f.object.PhotoFile).sort((a, b) => a.length > b.length ? -1 : 1).slice(0, 4);
      if (largestPhotoObjects.length) {
        for (let PhotoFile of largestPhotoObjects) {
          window.open('data:image/jpg;base64,'+PhotoFile);
        }
      }
      */
    });

    finished();

  }, 30000);
});
