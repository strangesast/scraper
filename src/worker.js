self.onmessage = function(evt) {
  if (typeof evt.data === 'string') {
    console.log('from main', evt.data);
  }
}
