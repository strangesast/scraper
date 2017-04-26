require('../assets/placeholder.png');
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

function isUsefulArray(arr, index) {
  return arr && arr.length;
}

let fileStream = Observable.fromEvent(fileInput, 'change')
  .pluck('target', 'files')
  .filter(isUsefulArray)
  .concatMap((arr, i) => Observable.from(arr));

function fileToStreams(file, id) {
  let blobStream = Observable.from(breakify(file, +chunkSizeInput.value)).share();
  let length = file.size;

  let responseStream = eachBlobCommands.filter(({ id: _id }) => id == _id);

  let objectFoundMessages = responseStream.filter(({ command }) => command === 'blobObjectFound');
  let objectsFound = objectFoundMessages.pluck('object');

  let nextCommands = responseStream.filter(({ command }) => command === 'blobNext');

  let messages = blobStream.concatMap(({ blob, pos }) => {
    let response = nextCommands.take(1)
      .flatMap(({ lastPos }) =>
        lastPos === pos ?
          Observable.empty() :
          Observable.throw(new Error('unexpected position')));
    let request = { command: 'blob', blob, pos, length, id };
    return Observable.of(request).concat(response);
  }).share();

  let progress = messages.map(({pos}) => [pos, length]);

  return { messages, progress, objects: objectsFound, fileName: file.name, fileModified: file.lastModified, fileId: id };
};

let main = fileStream.map(fileToStreams);

function sendMessage(message) {
  return worker.postMessage(message);
};

main.pluck('messages').mergeAll().subscribe(
  sendMessage,
  err => console.error(err),
  _ => console.log('complete')
);

let lastObjectId = -1;
let objects = main.mergeMap(({ objects, fileId }) => objects.map(data => ({
  id: ++lastObjectId,
  data,
  file: fileId
}))).share();

function getName(data) {
}

objects.filter(({ data: { FullName, first, last, FirstName, LastName }}) => !FullName && !first && !last && !FirstName && !LastName).take(10).subscribe(console.log.bind(console));
//objects.filter(({ data: { PhotoFile }}) => PhotoFile).pluck('data', 'PhotoFile').subscribe(data => window.open(data));

let objectCount = objects.mapTo(1).scan((a, b) => a+b, 0);

let progress = main.pluck('progress')
  .switchMap(stream => {
    let start = Date.now();
    let lastt = start;
    let lastp = 0;
    let pipe = stream.map(([p, of]) => {
      return [Date.now(), p, p/of];
    });
    return pipe.pairwise()
      .map(([[a, b, c], [d, e, f]]) => [1000*(e-b)/(d-a), f])
      .throttleTime(100)
      .startWith([0, 0])
      .finally(() => statsOutput.textContent = statsOutput.textContent+`| Total time: ${ ((Date.now() - start)/1000).toFixed(4) }s`);
  });

progress.withLatestFrom(objectCount).startWith([[0, 0], 0]).subscribe(
  ([[rate, percentage], o]) => {
    statsOutput.textContent = `found ${ o } | ${ formatPercentage(percentage) } | ${ formatBytes(rate)+'/s' }`
  },
  (err) => console.error(err),
  _ => console.log('complete')
);


let addToObjectArray = objects
  .bufferTime(100)
  .filter(a => a.length > 0)

let objectArray = addToObjectArray
  .scan((a, b) => a.concat(b), [])

let addToGraph = objectArray
  .map(calculateGraph)
  .subscribe(data => {
    //console.log('data', data);
  });

var tableElement = d3.select(document.body.querySelector('.table'));

var svgElement = document.body.querySelector('svg');
var svg = d3.select(svgElement);
let [width, height] = ['width', 'height'].map(t => +svg.style(t).replace('px', ''));
let min = 1000/Math.min(width, height);
[width, height] = [width, height].map(v => v*min);
var zoom = d3.zoom().scaleExtent([1, 8]).on('zoom', zoomed);

var drag = d3.drag()
  .subject((d) => ({ x: d.x - 300, y: d.y }))
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

calculateGraph([]);

function calculateGraph(people, fileName) {
  node = node.data(people, ({ id }) => id);
  table = table.data(people, ({ id }) => id);

  node.exit().remove()
  table.exit().remove()

  let nnode = node.enter().append('g')
    .attr('data-id', ({id}) => id)
    .call(drag)
    // too slow
    //.each(function(d) {
    //  queue.defer(loadImage, d, this);
    //})

  nnode.append('circle')
    .attr('r', circleRadius-borderRadius/2)
    .attr('fill', (d) => {
      return color(+d.file);
    })
    .attr('stroke', (d) => color(+d.file))
    .attr('stroke-width', borderRadius)

  nnode.filter(d => d.data.PhotoFile)
    .append('image')
    .attr('x', -circleRadius+borderRadius)
    .attr('y', -circleRadius+borderRadius)
    .attr('height', (circleRadius-borderRadius)*2)
    .attr('width', (circleRadius-borderRadius)*2)
    .attr('clip-path', 'url(#circleClip)')
    .attr('xlink:href', (d) => d.data.PhotoFile);

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

  tableRows//.filter(d => d.data.PhotoFile)
    .append('div')
    .attr('class', 'profile')
    .append('img')
    .attr('src', (d) => d.data.PhotoFile || 'assets/placeholder.png');
  tableRows.append('p')
    .text(({ data }) => {
      if (!data.FullName && data.first) {
        //console.log('data', data, 'id', id);
      }
      let name = data.FullName ? (data.FullName.first + ' ' + data.FullName.last) : (data.first || data.last) ? (data.first + ' ' + data.last) : (data.FirstName || data.LastName) ? (data.FirstName + ' ' + data.LastName) : 'fuck';
      return name;
    })


  node = nnode.merge(node);
  table = ntable.merge(table);

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
  node.attr('transform', (d) => `translate(${ d.x }, ${ d.y })`);
  //node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
}

function dragstarted(d) {
  if (!event.active) simulation.alphaTarget(1.0).restart();
  let n = this;
  node.style('opacity', function(d) {
    return (n === this) ? 1.0 : 0.4;
  });
  table.filter(`[data-id="${ d.id }"]`).style('background-color', 'lightgrey').each(function() {
    let p = this.parentElement.parentElement;
    console.log(p.offsetHeight);
    p.scrollTop = this.offsetTop - p.offsetHeight/3;
  });

  d.fx = d.x;
  d.fy = d.y;
}

function dragged(d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragended(d) {
  if (!event.active) simulation.alphaTarget(1.0);
  d3.select(this).style('opacity', 1.0);
  d.fx = null;
  d.fy = null;
  node.style('opacity', 1.0);
  table.filter(`[data-id="${ d.id }"]`).style('background-color', 'white');
}
