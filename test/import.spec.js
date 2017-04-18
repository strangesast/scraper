import importFile from '../src/import';

describe('import function', () => {
  it('should timeout', async(done) => {
    let req = await new Request('/data/example.dmp');
    let res = await fetch(req);
    let blob = await res.blob();

    await readIncrementally(blob);

    done();

  }, 30000);
});

function readIncrementally(blob) {
  return new Promise((resolve, reject) => {
    let size = blob.size;
    let reader = new FileReader();

    let pos = 0;
    let frac = 0.0;
    let incr = Math.pow(2, 16);
    let b = blob.slice(pos, pos+incr);
    let remainder = '';

    let start = Date.now();

    reader.onload = function(e) {
      let result = e.target.result;
      let index = result.lastIndexOf('\n');
      if (index > 0) {
        [result, remainder] = [remainder + result.substring(0, index+1), result.substring(index+1)];
      } else {
        [result, remainder] = ['', remainder+result];
      }
      pos+=incr;

      frac = pos/size;

      if (pos < size) {
        b = blob.slice(pos, pos+incr);
        reader.readAsText(b);
      } else if (remainder) {
        reject(new Error('not terminated with newline'));
      } else {
        resolve();
      }
    }

    reader.readAsText(b);
  });
}
