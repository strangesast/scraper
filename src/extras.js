import { Observable } from 'rxjs';
//import 'tracking'
//import 'tracking/build/data/face';
//const tracking = window.tracking; // fuck this
//console.log(tracking);
//const { ObjectTracker } = tracking;

// ugly
/*
export function findFace(stream) {
  let image = new Image();
  let imageSize;
  let canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  let ctx = canvas.getContext('2d');
  let tracker = new ObjectTracker('face');

  tracker.on('track', evt => {
    console.log(imageSize);
    if (evt.data && evt.data.length) {
      let { height, width, x, y } = evt.data[0];
      let cx = x + width/2;
      let cy = y + height/2;

      let size = Math.max(height, width)*1.1;

      let xi = Math.max(cx - size/2, 0);
      let yi = Math.max(cy - size/2, 0);

      ctx.strokeRect(xi, yi, size, size);
    } else if (imageSize > 1e5) {
      let [width, height] = [canvas.width, canvas.height];
      let size = Math.min(height, width);
      ctx.strokeRect((width-size)/2, (height-size)/2, size, size);
    }
  });

  return stream.concatMap(data => {
    let load = Observable.fromEvent(image, 'load').take(1);
    imageSize = data.length;
    image.src = 'data:image/png;base64,' + data;
    return load.concatMap(() => {
      let [width, height] = [image.width, image.height];
      canvas.width = Math.min(width, 500);
      canvas.height = canvas.width * height / width;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      tracking.trackCanvas_(canvas, tracker);
      return Observable.of(1).delay(1000);
    });
  });
}
*/
