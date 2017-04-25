require('./index.less');

import { Observable } from 'rxjs/Rx';
import { setupBlobCommandStream, breakify, streamObjectsFromBlob, formatPercentage } from '../src/stream';
import * as d3 from 'd3';

let MyWorker = require('worker-loader!./worker');
let worker = new MyWorker();

let eachBlobCommands = setupBlobCommandStream(worker, false);

var fileInput = document.getElementById('file-upload');

let fileStream = Observable.fromEvent(fileInput, 'change')
  .pluck('target', 'files')
  .filter(arr => arr && arr.length)
  .concatMap(arr => Observable.from(arr));

var lastId = -1;
let main = fileStream.map(file => {
  let id = ++lastId;
  console.log('file', file);

  let blobStream = Observable.from(breakify(file, 40000)).share();
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

  let progress = messages.map(({pos}) => pos/length);
  //let progress = blobStream.map(({ pos }) => pos/length);

  return { messages, progress, objects: objectsFound };

}).share();

main.pluck('messages').mergeAll().subscribe(message => {
  worker.postMessage(message)
}, (err) => console.error(err));

let objects = main.pluck('objects').mergeAll().share();
let objectCount = objects.mapTo(1).scan((a, b) => a+b, 0);

let progress = main.pluck('progress')
  .switchMap(stream => stream.map(formatPercentage).throttleTime(100).concat(Observable.of('DONE')));

progress.withLatestFrom(objectCount).subscribe(([p, o]) => console.log('found', o, p));

var image = document.querySelector('img');

function stripObject(obj) {
  // TODO: better checking
  return obj.FullName || { first: obj.FirstName, last: obj.LastName };
}

objects
  .map((obj, id) => ({data: obj, id }))
  .bufferTime(100)
  //.filter(a => a.length > 0)
  .scan((a, b) => a.concat(b), [])
  .subscribe(calculateGraph);

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
  .alphaTarget(0.01)
  .on('tick', ticked);

let g = svg.append('g');
var node = g.append('g').selectAll('circle');

let test = Array.from(Array(500)).map((_, id) => ({ id, data: { name: `Node ${ id }` } }));
calculateGraph(test);

function calculateGraph(people) {
  node = node.data(people, ({ id }) => id)

  node.exit().remove()

  node = node.enter().append('circle')
    .attr('r', circleRadius-borderRadius/2)
    .attr('fill', (d) => color(+d.SiteCode))
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended))
      .on('mouseover', mouseover)
      .on('mouseleave', mouseleave)
    .merge(node)

  //node.append('title').text(d => ['first', 'last'].map(n => d.object[n]).join(', '));

  simulation.nodes(people)//.on('tick', ticked);
  simulation.alpha(1).restart();
}

function ticked() {
  node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
}

function mouseover(d) {
  d3.select(this).style('opacity', 0.5);
}

function mouseleave(d) {
  d3.select(this).style('opacity', 1.0);
}

function dragstarted(d) {
  if (!d3.event.active) simulation.alphaTarget(0.1).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(d) {
  d.fx = d3.event.x;
  d.fy = d3.event.y;
}

function dragended(d) {
  if (!d3.event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}
