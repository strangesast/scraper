require('./index.less');

import { Observable } from 'rxjs';
import { streamObjectsFromBlob, formatPercentage } from '../src/stream';
import * as d3 from 'd3';

let MyWorker = require('worker-loader!./worker');
let worker = new MyWorker();
console.log('worker', worker);

worker.onmessage = function(evt) {
  console.log('from worker', evt.data);
  setTimeout(() => worker.postMessage(evt.data), 1000);
}
worker.postMessage('toast!')

var fileInput = document.getElementById('file-upload');

var image = document.querySelector('img');


function stripObject(obj) {
  // TODO: better checking
  console.log(obj);
  return obj.FullName || { first: obj.FirstName, last: obj.LastName };
}

Observable.fromEvent(fileInput, 'change').pluck('target', 'files').concatMap(files => {
  return Observable.from(files);
}).concatMap(file => {
  let { objects, ids, progress } = streamObjectsFromBlob(file);

  return Observable.zip(ids, objects).map(([id, object]) => ({ id, object: stripObject(object) })).take(100).bufferTime(1000);

  //return Observable.combineLatest(progress.map(formatPercentage), objects.mapTo(1).scan((a, b) => a+b, 0)).map(p => p.join(', '))

}).subscribe(res => {
  people.push(...res);
  calculateGraph();
}, (err) => console.error(err));


var svg = d3.select(document.body.querySelector('svg'));
var width = +svg.attr('width');
var height = +svg.attr('height');
const circleRadius = 10;
const borderRadius = 4;

var color = d3.scaleOrdinal(d3.schemeCategory20);

var bodyForce = d3.forceManyBody()
  .strength(-circleRadius)

var gravityx = d3.forceX(width/2)
  .strength(0.5)
var gravityy = d3.forceY(height/2)
  .strength(0.5)


var simulation = d3.forceSimulation()
  .force('collision', d3.forceCollide(circleRadius))
  .force('gravityx', gravityx)
  .force('gravityy', gravityy)
  .force('charge', bodyForce)
  .force('center', d3.forceCenter(width/2, height/2));

let people = [];

var node;
var nd = svg.append('g')
  .attr('class', 'nodes')
  .selectAll('circle')

function calculateGraph() {
  node = nd.data(people, ({ id }) => id)
    .enter()
    .append('circle')
    .attr('r', circleRadius-borderRadius/2)
    .attr('fill', (d) => color(+d.SiteCode))
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended));

  node.append('title').text(d => ['first', 'last'].map(n => d.object[n]).join(', '));

  simulation.nodes(people).on('tick', ticked);
}

function ticked() {
  node.attr('cx', (d) => d.x);
  node.attr('cy', (d) => d.y);
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
