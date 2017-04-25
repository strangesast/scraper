require('./index.less');

import { Observable } from 'rxjs/Rx';
import { shrinkCropPhoto } from '../src/parse';
import { setupBlobCommandStream, breakify, streamObjectsFromBlob, formatPercentage, formatBytes } from '../src/stream';
import * as d3 from 'd3';

let chunkSizeInput = document.getElementById('chunk-size');
let statsOutput = document.getElementById('stats');

let MyWorker = require('worker-loader!./worker');
let worker = new MyWorker();

let eachBlobCommands = setupBlobCommandStream(worker, false);

var fileInput = document.getElementById('file-upload');

let fileStream = Observable.fromEvent(fileInput, 'change')
  .pluck('target', 'files')
  .filter(arr => arr && arr.length)
  .concatMap(arr => Observable.from(arr));

var lastFileId = -1;
let main = fileStream.map(file => {
  let id = ++lastFileId;
  let blobStream = Observable.from(breakify(file, +chunkSizeInput.value)).share();
  let length = file.size;

  let responseStream = eachBlobCommands.filter(({ id: _id }) => id == _id);

  let objectFoundMessages = responseStream.filter(({ command }) => command === 'blobObjectFound');
  let objectsFound = objectFoundMessages.pluck('object');

  let nextCommands = responseStream.filter(({ command }) => command === 'blobNext');

  let messages = blobStream.concatMap(({ blob, pos }) => {
    let response = nextCommands.take(1)
      //.do(({lastPos}) => console.log(`${ formatPercentage(lastPos / length) }`))
      .flatMap(({ lastPos }) =>
        lastPos === pos ?
          Observable.empty() :
          Observable.throw(new Error('unexpected position')));
    let request = { command: 'blob', blob, pos, length, id };
    return Observable.of(request).concat(response);
  }).share();

  let progress = messages.map(({pos}) => [pos, length]);

  return { messages, progress, objects: objectsFound, fileName: file.name, fileModified: file.lastModified, fileId: id };

}).share();

main.pluck('messages').mergeAll().subscribe(message => {
  worker.postMessage(message)
}, (err) => console.error(err));

let lastObjectId = -1;
let objects = main.mergeMap(({ objects, fileId }) => {
  return objects.map(data => ({
    id: ++lastObjectId,
    data,
    file: fileId
  }));
}).share();

let objectCount = objects.mapTo(1).scan((a, b) => a+b, 0);

let progress = main.pluck('progress')
  .switchMap(stream => {
    let start = Date.now();
    let lastt = start;
    let lastp = 0;
    let pipe = stream.map(([p, of]) => {
      return [Date.now(), p, p/of];
    });
    return pipe.pairwise().map(([[a, b, c], [d, e, f]]) => [1000*(e-b)/(d-a), f]).throttleTime(100).finally(() => console.log('TOTAL', Date.now() - start));
  });

progress.withLatestFrom(objectCount).subscribe(([[rate, percentage], o]) => {
  statsOutput.textContent = ['found', o, formatPercentage(percentage), formatBytes(rate)+'/s'].join(' | ');
});

var image = document.querySelector('img');

function stripObject(obj) {
  // TODO: better checking
  return obj.FullName || { first: obj.FirstName, last: obj.LastName };
}

objects
  .bufferTime(100)
  .filter(a => a.length > 0)
  .scan((a, b) => a.concat(b), [])
  .map(calculateGraph)
  .subscribe();

var svg = d3.select(document.body.querySelector('svg'));
let [width, height] = ['width', 'height'].map(t => +svg.style(t).replace('px', ''));
let min = 1000/Math.min(width, height);
[width, height] = [width, height].map(v => v*min);
svg.attr('viewBox', `0 0 ${ width } ${ height }`);
const circleRadius = 14;
const borderRadius = 2;

var color = d3.scaleOrdinal(d3.schemeCategory20);

var bodyForce = d3.forceManyBody()
  .strength(-2.5)

var gravityx = d3.forceX(width/2)
  .strength(0.01)
var gravityy = d3.forceY(height/2)
  .strength(0.01)

var simulation = d3.forceSimulation()
  .force('collision', d3.forceCollide(circleRadius))
  .force('gravityx', gravityx)
  .force('gravityy', gravityy)
  .force('charge', bodyForce)
  //.force('center', d3.forceCenter(width/2, height/2))
  .alphaTarget(1.0)
  .on('tick', ticked);

let g = svg.append('g');
var node = g.append('g').selectAll('circle');

let test = Array.from(Array(500)).map((_, id) => ({ id, data: { name: `Node ${ id }` } }));

var queue = d3.queue(2);
calculateGraph([]);
//calculateGraph(test);

function calculateGraph(people, fileName) {
  node = node.data(people, ({ id }) => id)

  node.exit().remove()

  node = node.enter().append('circle')
    .attr('r', circleRadius-borderRadius/2)
    .attr('fill', (d) => {
      return color(+d.file);
    })
    .attr('stroke', (d) => color(+d.file))
    .attr('stroke-width', borderRadius)
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended))
      .on('mouseover', mouseover)
      .on('mouseleave', mouseleave)
    // too slow
    //.each(function(d) {
    //  queue.defer(loadImage, d, this);
    //})
    .merge(node);

  //node.append('title').text(d => ['first', 'last'].map(n => d.object[n]).join(', '));

  simulation.nodes(people)//.on('tick', ticked);
  simulation.alpha(1.0).restart();

  return node;
}

async function loadImage(obj, element, callback) {
  if (obj.data.PhotoFile) {
    let data = obj.data.PhotoFile;

    let url = await shrinkCropPhoto(Observable.of(data)).toPromise();
    let pat = svg.select('defs').append('pattern');

    let id = `image-${ obj.id }`;
    pat
      .attr('id', id)
      .attr('x', -circleRadius)
      .attr('y', -circleRadius)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('height', circleRadius*2)
      .attr('width', circleRadius*2)
      .append('image')
        .attr('x', '0')
        .attr('y', '0')
        .attr('width', circleRadius*2)
        .attr('height', circleRadius*2)
        .attr('xlink:href', url)

    d3.select(element).attr('fill', `url(#${ id })`);
  }
  callback();
}

function ticked() {
  node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
}

function mouseover(d) {
  console.log(d);
  d3.select(this).style('opacity', 0.5);
}

function mouseleave(d) {
  d3.select(this).style('opacity', 1.0);
}

function dragstarted(d) {
  if (!d3.event.active) simulation.alphaTarget(1.0).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(d) {
  d.fx = d3.event.x;
  d.fy = d3.event.y;
}

function dragended(d) {
  if (!d3.event.active) simulation.alphaTarget(1.0);
  d.fx = null;
  d.fy = null;
}
