require('../assets/placeholder.png');
require('./index.less');

import { Observable } from 'rxjs/Rx';
import { shrinkCropPhoto } from '../src/parse';
import { setupBlobCommandStream, breakify, breakifyStream, streamObjectsFromBlob, formatPercentage, formatBytes } from '../src/stream';
import * as d3 from 'd3';

let chunkSizeInput = document.getElementById('chunk-size');
let includePhotosCheckbox = document.getElementById('include-photos');
let displayPhotosCheckbox = document.getElementById('display-photos');
let statsOutput = document.getElementById('import0');
let generateOutput = document.getElementById('export');
let downloadOutput = document.getElementById('download');

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

function* blobToMessages(id, file, chunkSize, includePhotos) {
  let port = worker1; // temp
  let command = 'blob';
  let g = breakify(file, chunkSize);
  let { done, value } = g.next();
  while (!done) {
    let { pos, blob } = value;
    port.postMessage({ command, blob, pos, id, done, includePhotos });
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
  
    let chunkSize = +chunkSizeInput.value;
    let includePhotos = includePhotosCheckbox.checked;

    let processing = breakifyStream(blobToMessages(id, file, chunkSize, includePhotos), nextMessages, nextResponseValidator);
  
    return processing.map(p => ({ file: file.name, pos: Math.min(p+chunkSize, size), size, time: performance.now() - start }));
  })
  .mergeAll(3)
  .scan((a, b) => {
    // keep the latest point of each file
    for (let i=0; i < a.length; i++) {
      if (a[i].file == b.file) {
        a[i] = b;
        return a;
      }
    }
    return a.concat(b);
  }, [])
  .map(v => updateImportProgress(v)) // ugly
  .subscribe(null, (err) => console.error(err));

let imports = d3.select(document.getElementById('imports')).selectAll('.import');
let fileIds = {};
let lastFileId = -1;
function updateImportProgress(data) {
  imports = imports.data(data, ({ file }) => file);

  let n = imports.enter().append('div').attr('class', 'import');
  n.append('span').attr('class', 'name').text((d) => d.file);
  n.append('progress').attr('value', 0);
  n.append('span').attr('class', 'rate')

  imports = n.merge(imports)
    
  imports.select('progress').attr('value', d => d.pos/d.size);
  imports.select('.rate').text(d => formatBytes(d.pos/d.time*1000) + '/s');
}

let lastId = 0;
let objects = worker1Messages.filter(isCommand('blobObjectsFound')).map(({ objects, id: fileId }) => {
  return objects.map(data => ({ data, id: lastId++, file: fileId }));
}).concatMap(a => Observable.from(a)).share();

let nest = d3.nest().key((d) => d.data.AreaLinks ? d.data.AreaLinks.map(a => a.join('-')).join('\n') : 'uncategorized');

let objectArray = objects.bufferTime(50).filter(a => a.length).scan((a, b) => a.concat(b), [])
  
objectArray.subscribe(objects => {
  //let data = nest.entries(objects);

  calculateGraph(objects);
}, (err) => console.error(err));

const cols = [
  { name: 'External System ID', include: true, defaultValue: null },
  { name: 'Load Date',          include: true, defaultValue: null },
  { name: 'First Name',         include: true, defaultValue: null },
  { name: 'Last Name',          include: true, defaultValue: null },
  { name: 'Middle Name',        include: true, defaultValue: null },
  { name: 'Roles',              include: true, defaultValue: null },
  { name: 'Status',             include: true, defaultValue: '0' },
  { name: 'Partition',          include: true, defaultValue: null },
  { name: 'Address',            include: true, defaultValue: null },
  { name: 'City',               include: true, defaultValue: null },
  { name: 'State',              include: true, defaultValue: null },
  { name: 'Zip',                include: true, defaultValue: null },
  { name: 'Phone',              include: true, defaultValue: null },
  { name: 'Work Phone',         include: true, defaultValue: null },
  { name: 'Email Address',      include: true, defaultValue: null },
  { name: 'Title',              include: true, defaultValue: null },
  { name: 'Department',         include: true, defaultValue: null },
  { name: 'Building',           include: true, defaultValue: null },
  { name: 'Embossed Number',    include: true, defaultValue: null },
  { name: 'Token Unique',       include: true, defaultValue: null },
  { name: 'Internal Number',    include: true, defaultValue: null },
  { name: 'Download',           include: true, defaultValue: 'f' },
  { name: 'Token Status',       include: true, defaultValue: '2' }
];

let exportSettings = d3.select(document.getElementById('export-settings'));
let defaultRows = exportSettings.select('.cols').selectAll('.col:not(.header)').data(cols).enter().append('div').attr('class', 'col');
defaultRows.append('span').attr('class', 'name').attr('title', d => d.name).text(d => d.name);
defaultRows.append('input').attr('class', 'include').attr('type', 'checkbox').attr('disabled', true).attr('checked', d => !!d.include);
defaultRows.append('input').attr('class', 'default').attr('type', 'text').attr('value', d => d.defaultValue);

function getDefault() {
  let obj = {};
  defaultRows.select('.default').each(function(v) {
    let val = this.value;
    if (this.value != '') {
      obj[v.name] = val;
    }
  });
  return obj;
}

Observable.fromEvent(generateOutput, 'click').withLatestFrom(objectArray)
  .map(([e, arr]) => {
    let data = nest.entries(arr);
    let defaults = getDefault();
    arr = data.map(({ key, values }, j) => {
      let Roles = 'Group' + j;
      //if (Array.isArray(Roles)) Roles = Roles.join('|');
      return values.map(obj => Object.assign({}, defaults, obj.data, { Roles }));
    }).reduce((a, b) => a.concat(b), []);
    let loadDate = new Date().toLocaleString();
    let text = arr.map((data, i) => {
      return [
        i+1,
        loadDate,
        data['First Name'],
        data['Last Name'],
        data['Middle Name'],
        data['Roles'],
        data['Status'],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        data['Title'],
        data['Department'],
        data['Building'],
        data['Embossed Number'],
        data['Token Unique'],
        data['Internal Number'],
        data['Download'],
        data['Token Status']
      ].map(v => v !== undefined ? JSON.stringify(v) : '').join(',');
    }).join('\r\n');
    let blob = new Blob([text], { type: 'text/plain' });
    return URL.createObjectURL(blob);
  })
  .subscribe(output => {
    downloadOutput.disabled = false;
    downloadOutput.setAttribute('download', 'dump.csv');
    downloadOutput.setAttribute('href', output);
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

  if (displayPhotosCheckbox.checked) {
    nnode
      .append('image')
      .attr('x', -circleRadius+borderRadius)
      .attr('y', -circleRadius+borderRadius)
      .attr('height', (circleRadius-borderRadius)*2)
      .attr('width', (circleRadius-borderRadius)*2)
      .attr('clip-path', 'url(#circleClip)')
      .attr('xlink:href', (d) => d.data.PhotoFile || 'assets/placeholder.png');
  }

  let ntable = table.enter().append('div').attr('class', 'row')
    .on('mouseenter', function(d) {
      d3.select(this).style('background-color', 'lightgrey');
      node.style('opacity', 0.4);
      node.filter(`[data-id="${ d.id }"]`).style('opacity', 1.0);
    })
    .on('mouseleave', function(d) {
      d3.select(this).style('background-color', null);
      node.style('opacity', 1.0);
    })

  let tableRows = ntable
    .attr('data-id', ({id}) => id)

  tableRows
    .append('div')
    .attr('class', 'profile')
    .append('img')
    .attr('src', (d) => d.data.PhotoFile || 'assets/placeholder.png');

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
  table.filter(`[data-id="${ d.id }"]`).style('background-color', null);
}
