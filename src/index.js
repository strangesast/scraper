require('../assets/placeholder.png');
require('./index.less');

import { Observable } from 'rxjs/Rx';
import { shrinkCropPhoto } from '../src/parse';
import { setupBlobCommandStream, breakify, breakifyStream, streamObjectsFromBlob, formatPercentage, formatBytes } from '../src/stream';
import * as d3 from 'd3';

let chunkSizeInput = document.getElementById('chunk-size');
let statsOutput = document.getElementById('stats');

let MyWorker = require('worker-loader!./worker');
let worker1 = new MyWorker();
let worker2 = new MyWorker();

let worker1Messages = Observable.fromEvent(worker1, 'message').pluck('data').filter(d => d && d.command);
let worker2Messages = Observable.fromEvent(worker2, 'message').pluck('data').filter(d => d && d.command);

var fileInput = document.getElementById('file-upload');

let fileStream = Observable.fromEvent(fileInput, 'change')
  .pluck('target', 'files')
  .concatMap((arr, i) => Observable.from(arr));

function isCommand(_command) {
  return ({ command }) => command === _command;
};

function* blobToMessages(id, file, chunkSize) {
  let port = worker1; // temp
  let command = 'blob';
  let g = breakify(file, chunkSize);
  let { done, value } = g.next();
  while (!done) {
    let { pos, blob } = value;
    port.postMessage({ command, blob, pos, id, done });
    yield pos;
    ({ done, value } = g.next());
  }
  port.postMessage({ command, done });
};

function nextResponseValidator(pos, { lastPos}) {
  if (pos != lastPos) throw new Error('unexpected response');
};

let idToName = {};

fileStream
  .map((file, id) => {
    let size = file.size;
    let start = performance.now();
    idToName[id] = file.name;
  
    let myWorkerMessages = worker1Messages.filter(({ id: _id }) => _id === id);
    let nextMessages = myWorkerMessages.filter(isCommand('blobNext'));
  
    let processing = breakifyStream(blobToMessages(id, file, +chunkSizeInput.value), nextMessages, nextResponseValidator);
  
    //let objects = myWorkerMessages.filter(isCommand('blobObjectsFound')).pluck('objects');
    //let objectsCount = objects.pluck('length').scan((a, b) => a+b, 0).startWith(0);
  
    //return processing.withLatestFrom(objectsCount).map(([p, n]) => file.name + ' ' + formatPercentage(p/size) + ' ' + n + ' objects').finally(() => console.log('complete', ((Date.now() - start)/1000).toFixed(4)));
    return processing.map(p => file.name + ' ' + formatPercentage(p/size) + ' ' + ((performance.now() - start)/1000).toFixed(4) + 's');
  })
  .mergeAll(3)
  .subscribe((p) => statsOutput.textContent = p, (err) => console.error(err));

let lastId = 0;
let objects = worker1Messages.filter(isCommand('blobObjectsFound')).map(({ objects, id: fileId }) => {
  return objects.map(data => ({ data, id: lastId++, file: fileId }));
}).concatMap(a => Observable.from(a)).share();

let nest = d3.nest().key((d) => d.data.AreaLinks ? d.data.AreaLinks.map(a => a.join('-')).join('\n') : 'uncategorized');

objects.bufferTime(50).filter(a => a.length).scan((a, b) => a.concat(b), []).subscribe(objects => {
  //let data = nest.entries(objects);

  calculateGraph(objects);
});

/* too much memory
let withPhoto = objects.filter(x => x.data.PhotoFile);

let photoMessages = worker2Messages.filter(isCommand('photoNext'));

withPhoto.take(1).expand(({ data, id: sentId }) => {
  let response = photoMessages.take(1);

  worker2.postMessage({ command: 'photo', photo: data.PhotoFile, id: sentId });

  return response.flatMap(({ id: recId, url }) => {
    node.filter(`[data-id="${ recId }"]`).select('image').attr('xlink:href', url);
    table.filter(`[data-id="${ recId }"]`).select('img').attr('src', url);
    return withPhoto.take(1);
  });
}).subscribe();
*/

var svg = d3.select(document.body.querySelector('svg'));
let [width, height] = ['width', 'height'].map(t => +svg.style(t).replace('px', ''));
let min = 1000/Math.min(width, height);
[width, height] = [width, height].map(v => v*min);
var zoom = d3.zoom().scaleExtent([1, 8]).on('zoom', zoomed);

var drag = d3.drag()
  //.subject((d) => ({ x: d.x - 300, y: d.y }))
  .on('start', dragstarted)
  .on('drag', dragged)
  .on('end', dragended);

//svg.attr('viewBox', `0 0 ${ width } ${ height }`);
svg.call(zoom);

function zoomed() {
  container.attr('transform', d3.event.transform);
}

const circleRadius = 14;
const borderRadius = 2;

function calcR(s) {
  return Math.sqrt(2*Math.sqrt(3)/Math.PI*s*Math.pow(circleRadius*1.3, 2));
}

var color = d3.scaleOrdinal(d3.schemeCategory20);

var bodyForce = d3.forceManyBody()
  .strength(-10.0)
  //.distanceMin(circleRadius)

var gravityx = d3.forceX(width/2)
  .strength(0.03)
var gravityy = d3.forceY(height/2)
  .strength(0.03)

var collision = d3.forceCollide().radius((d) => (d) => calcR(d.values.length));

var simulation = d3.forceSimulation()
  .force('collision', collision)
  .force('gravityx', gravityx)
  .force('gravityy', gravityy)
  .force('charge', bodyForce)
  //.force('center', forceCenter(width/2, height/2))
  .alphaTarget(1.0)
  .on('tick', ticked);

svg.append('clipPath')
  .attr('id', 'circleClip')
  .append('circle')
  .attr('r', circleRadius-borderRadius)
  .attr('cx', 0)
  .attr('cy', 0)

let container = svg.append('g');
var node = container.append('g').selectAll('g');
var table = d3.select(document.body.querySelector('.table')).selectAll('.row');

let test = Array.from(Array(500)).map((_, id) => ({ id, data: { name: `Node ${ id }` } }));

/*
var wells = container.append('g').selectAll('g');

function calculateWells(data) {
  console.log(data);
  wells = wells.data(data, ({ key }) => key);

  wells.exit().remove();

  wells = wells.enter()
    .append('g')
    .call(drag)
    .append('circle')
    .attr('fill', (d, i) => color(i))
    .attr('r', (d) => calcR(d.values.length))
    .merge(wells);

  simulation.nodes(data)
  collision.initialize(simulation.nodes());
  simulation.alpha(1.0).restart();
  reset();
}
*/

function calculateGraph(people, fileName) {
  node = node.data(people, ({ id }) => id);
  table = table.data(people, ({ id }) => id);

  node.exit().remove()
  table.exit().remove()

  let nnode = node.enter().append('g')
    .attr('data-id', ({id}) => id)
    .call(drag)

  nnode.append('circle')
    .attr('r', circleRadius-borderRadius/2)
    .attr('fill', (d) => {
      return color(+d.file);
    })
    .attr('stroke', (d) => color(+d.file))
    .attr('stroke-width', borderRadius)

  /*
  nnode
    .append('image')
    .attr('x', -circleRadius+borderRadius)
    .attr('y', -circleRadius+borderRadius)
    .attr('height', (circleRadius-borderRadius)*2)
    .attr('width', (circleRadius-borderRadius)*2)
    .attr('clip-path', 'url(#circleClip)')
    .attr('xlink:href', (d) => d.data.PhotoFileResized);
  */

  let ntable = table.enter().append('div').attr('class', 'row')
    .on('mouseenter', function(d) {
      d3.select(this).style('background-color', 'lightgrey');
      node.style('opacity', 0.4);
      node.filter(`[data-id="${ d.id }"]`).style('opacity', 1.0);
    })
    .on('mouseleave', function(d) {
      d3.select(this).style('background-color', 'white');
      node.style('opacity', 1.0);
    })

  let tableRows = ntable
    .attr('data-id', ({id}) => id)

  tableRows
    .append('div')
    .attr('class', 'profile')
    .append('img')
    .attr('src', (d) => d.data.PhotoFileResized || 'assets/placeholder.png');

  tableRows.append('p')
    .text(({ data }) => [data['First Name'], data['Middle Name'], data['Last Name']].filter(s => s).join(' '));

  node = nnode.merge(node);
  table = ntable.merge(table);

  simulation.nodes(people);
  simulation.alpha(1.0).restart();
  reset();

  return node;
}

function loadImage(d, element, callback) {
  setTimeout(() => {
    console.log('id', d.id);
    callback(d.id)
  }, 1000);
}

//async function loadImage(obj, element, callback) {
//  if (obj.data.PhotoFile) {
//    let data = obj.data.PhotoFile;
//
//    let url = await shrinkCropPhoto(Observable.of(data)).toPromise();
//    let pat = svg.select('defs').append('pattern');
//
//    let id = `image-${ obj.id }`;
//    pat
//      .attr('id', id)
//      .attr('x', -circleRadius)
//      .attr('y', -circleRadius)
//      .attr('patternUnits', 'userSpaceOnUse')
//      .attr('height', circleRadius*2)
//      .attr('width', circleRadius*2)
//      .append('image')
//        .attr('x', '0')
//        .attr('y', '0')
//        .attr('width', circleRadius*2)
//        .attr('height', circleRadius*2)
//        .attr('xlink:href', url)
//
//    d3.select(element).attr('fill', `url(#${ id })`);
//  }
//  callback();
//}

function reset() {
  i = 0;
}

var i = 0;
const maxSeqTicks = 200;
function ticked() {
  if (i++ > maxSeqTicks) {
    simulation.stop();
    i = 0;
  }
  //wells.attr('transform', (d) => `translate(${ d.x }, ${ d.y })`);
  node.attr('transform', (d) => `translate(${ d.x }, ${ d.y })`);
}


function dragstarted(d) {
  if (!event.active) {
    simulation.alphaTarget(1.0).restart();
    reset();
  }
  let n = this;
  node.style('opacity', function(d) {
    return (n === this) ? 1.0 : 0.4;
  });
  table.filter(`[data-id="${ d.id }"]`).style('background-color', 'lightgrey').each(function() {
    let p = this.parentElement.parentElement;
    p.scrollTop = this.offsetTop - p.offsetHeight/3;
  });

  d.fx = d.x;
  d.fy = d.y;
}


function dragged(d) {
  d.fx = event.x;
  d.fy = event.y;
  reset();
}


function dragended(d) {
  if (!event.active) simulation.alphaTarget(1.0);
  d3.select(this).style('opacity', 1.0);
  d.fx = null;
  d.fy = null;
  node.style('opacity', 1.0);
  table.filter(`[data-id="${ d.id }"]`).style('background-color', 'white');
}
