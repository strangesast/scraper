import importFile from '../src/import';

describe('import function', () => {
  it('should timeout', async(done) => {
    await new Promise(r => setTimeout(r, 1000));

    done();
  });
});
