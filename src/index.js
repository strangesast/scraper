require('../assets/placeholder.png');
require('./index.less');

import { Observable, ReplaySubject } from 'rxjs/Rx';
import { breakify, breakifyStream, formatBytes } from '../src/stream';
const d3 = Object.assign(require('d3'), require('d3-scale-chromatic')); // whew

var getElementById = document.getElementById.bind(document);
var generateOutput = getElementById('export');
var outputFilenameInput = getElementById('output-filename');
var downloadOutput = getElementById('download');
var includeKeymapCheckbox = getElementById('include-keymap');
var includeHeaderCheckbox = getElementById('include-header');

var MyWorker = require('worker-loader!./worker');
var worker = new MyWorker();
var workerMessages = Observable.fromEvent(worker, 'message')
  .pluck('data')
  .filter(d => d && d.command);

var fileStream = Observable.fromEvent(getElementById('file-upload'), 'change')
  .pluck('target', 'files')
  .concatMap((arr, i) => Observable.from(arr));

function isCommand(_command) {
  return ({ command }) => command === _command;
};

function* blobToMessages(id, file, chunkSize, includePhotos) {
  let port = worker; // temp
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

let chunkSizeInput = getElementById('chunk-size');
let includePhotosCheckbox = getElementById('include-photos');
fileStream
  .map((file, id) => {
    let size = file.size;
    let start = performance.now();
    let myWorkerMessages = workerMessages.filter(({ id: _id }) => _id === id);
    let nextMessages = myWorkerMessages.filter(isCommand('blobNext'));
  
    let chunkSize = +chunkSizeInput.value;
    let includePhotos = includePhotosCheckbox.checked;

    let processing = breakifyStream(blobToMessages(id, file, chunkSize, includePhotos), nextMessages, nextResponseValidator);
  
    return processing.map(p => ({ file: file.name, pos: Math.min(p+chunkSize, size), size, time: performance.now() - start }));
  })
  .mergeAll(100)
  .scan((a, b) => {
    // keep the latest point of each file, might be slow
    for (let i=0; i < a.length; i++) {
      if (a[i].file == b.file) {
        a[i] = b;
        return a;
      }
    }
    return a.concat(b);
  }, [])
  .map(v => updateImportProgress(v))
  .subscribe(null, (err) => console.error(err));

var imports = d3.select(getElementById('imports')).selectAll('.import');
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
let objects = workerMessages
  .filter(isCommand('blobObjectsFound'))
  .map(({ objects, id: fileId }) => objects.map(data => ({ data, id: lastId++, file: fileId })))
  .scan((a, b) => a.concat(b), []);

let nest = d3.nest()
  .key((d) => (d.data.AreaLinks && d.data.AreaLinks.length) ?
      d.data.AreaLinks.map(a => a[0].split('\\').slice(-1)[0]).join('\n') :
      'uncategorized')
  .sortKeys((a, b) => a.length > b.length ? 1 : b.length > a.length ? -1 : 0)

//objects.map(calculateGraph).subscribe(null, console.error.bind(console));
function setupRangePreview(canvas) {
  var [rw, rh] = [canvas.width, canvas.height];
  var ctx = canvas.getContext('2d');

  return function ([threshold, pow]) {
    ctx.clearRect(0, 0, rw, rh);
    ctx.save();
    ctx.translate(rw*0.1, rh*0.1);
    ctx.scale(0.8, 0.8);
    ctx.beginPath();
    ctx.moveTo(0, rh*(1-threshold));
    ctx.lineTo(rw, rh*(1-threshold));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rh, 0);
    for (let x=0; x < rw; x+=rw/100) {
      ctx.lineTo(rh*(1 - Math.pow(x/rw, pow)), x);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function mergeUpdateInputEvents(elements, eventName='input') {
  return Observable.merge(...elements.map(el => Observable.fromEvent(el, eventName)
    .pluck('target', 'value')
    .do(val => {
      for (let _el of elements) if (_el !== el) _el.value = val;
    }))).startWith(elements[0].value);
}

var currentRange = new ReplaySubject(1);
var currentMethod = new ReplaySubject(1);
var currentAveraged = new ReplaySubject(1);
var currentDir = new ReplaySubject(1);
var currentGraph = new ReplaySubject(1);

const methodElements = ['percent-method', 'count-method'].map(getElementById);
var methodVals = Observable.merge(...methodElements.map(element => Observable.fromEvent(element, 'change').pluck('target', 'value'))).startWith(methodElements[0].value);

const averagedElement = getElementById('averaged');
var averagedVals = Observable.fromEvent(averagedElement, 'change').map(() => averagedElement.checked).startWith(true);

const thresholdElements = ['threshold-range', 'threshold-numeric'].map(getElementById);
const powerElements = ['power-range', 'power-numeric'].map(getElementById);

const dirElements = ['one-dir', 'two-dir'].map(getElementById);
var dirVals = Observable.merge(...dirElements.map(element => Observable.fromEvent(element, 'change').pluck('target', 'value'))).startWith(dirElements[0].value);

var rangeVals = methodVals.switchMap(method => {
  if (method === 'percent') {
    thresholdElements.forEach(el => {
      el.setAttribute('min', 0);
      el.setAttribute('step', 0.01);
      el.setAttribute('max', 1);
      el.value = 0.5;
    });
    powerElements.forEach(el => {
      el.disabled = false;
      el.value = 5;
    });
  } else if (method === 'count') {
    thresholdElements.forEach(el => {
      el.setAttribute('min', 0);
      el.setAttribute('step', 1);
      el.setAttribute('max', 20);
      el.value = 1
    });
    powerElements.forEach(el => {
      el.disabled = true;
    });
  }
  return Observable.combineLatest(
    mergeUpdateInputEvents(thresholdElements),
    mergeUpdateInputEvents(powerElements)
  );
});

const graphElements = ['correlation-graph', 'category-graph'].map(getElementById);
var graphVals = Observable.merge(...graphElements.map(element => Observable.fromEvent(element, 'change').pluck('target', 'value'))).startWith(graphElements[0].value);

rangeVals.subscribe(currentRange);
methodVals.subscribe(currentMethod);
averagedVals.subscribe(currentAveraged);
dirVals.subscribe(currentDir);
graphVals.subscribe(currentGraph);

var updateRangePreview = setupRangePreview(getElementById('range-preview'));
currentRange.map(updateRangePreview).subscribe();
currentMethod.subscribe(method => {
  if (method === 'count') {
    scolor = function(v) {
      return d3.interpolateBlues(Math.pow(Math.E, -v/2));
    };
  } else {
    scolor = d3.interpolateBlues.bind(d3);
  }
});

var last = 0;
objects.switchMap(arr => {
  let data = nest.entries(arr);
  let keymap = createKeyMap(data);

  return Observable.combineLatest(currentMethod, currentRange, currentAveraged).switchMap(([method, [threshold, pow], averaged]) => {
    let { mat, vect } = correlation(method, keymap, threshold, pow, averaged);
    return currentGraph.switchMap(graph => {
      if (graph == 'correlation') {
        return dirVals.map(dir => {
          //drawCorrelationMat(vect, mat, keymap, +dir);
          let sum = d3.nest().key((d) => d.x).rollup(v => v.filter(el => el.y > el.x).reduce((a, { value }) => a + value, 0)).entries(mat);
          draw(mat, vect, vect, sum);
        });
      } else if (graph == 'category') {
        let unique = getUniqueFrom(vect, keymap);
        let mat2 = vect.reduce((a, group, i) => a.concat(keymap[group].map((name, j) => ({ value: { group, name }, x: unique.indexOf(name), y: i , id: group+name}))), []);
        let sum = d3.nest().key((d) => d.x).rollup(v => v.length).entries(mat2);
        draw(mat2, unique, vect, sum);
        //drawCategories(vect, keymap);

        return Observable.never();
      }
    });
  });

}).subscribe(null, (err) => console.error(err));

const cols = [
  { name: 'External System ID', defaultValue: null },
  { name: 'Load Date',          defaultValue: null },
  { name: 'First Name',         defaultValue: null },
  { name: 'Last Name',          defaultValue: null },
  { name: 'Middle Name',        defaultValue: null },
  { name: 'Roles',              defaultValue: null },
  { name: 'Status',             defaultValue: 1    },
  { name: 'Partition',          defaultValue: null },
  { name: 'Address',            defaultValue: null },
  { name: 'City',               defaultValue: null },
  { name: 'State',              defaultValue: null },
  { name: 'Zip',                defaultValue: null },
  { name: 'Phone',              defaultValue: null },
  { name: 'Work Phone',         defaultValue: null },
  { name: 'Email Address',      defaultValue: null },
  { name: 'Title',              defaultValue: null },
  { name: 'Department',         defaultValue: null },
  { name: 'Building',           defaultValue: null },
  { name: 'Embossed Number',    defaultValue: null },
  { name: 'Token Unique',       defaultValue: null },
  { name: 'Internal Number',    defaultValue: null },
  { name: 'Download',           defaultValue: 't'  },
  { name: 'Token Status',       defaultValue: 1    }
];

let exportSettings = d3.select(document.getElementById('export-settings'));
let defaultRows = exportSettings.select('.cols').selectAll('.col:not(.header)').data(cols).enter().append('div').attr('class', 'col');
defaultRows.append('span').attr('class', 'name').attr('title', d => d.name).text(d => d.name);
defaultRows.append('input').attr('class', 'default').attr('required', '').attr('type', 'text').attr('value', d => d.defaultValue);

function getDefaults() {
  let obj = {};
  defaultRows.select('.default').each(function(v) {
    let val = this.value;
    if (this.value != '') {
      obj[v.name] = val;
    }
  });
  return obj;
}

const header = [
  'External System ID',
  'Load Date',
  'First Name',
  'Last Name',
  'Middle Name',
  'Roles',
  'Status',
  'Partition',
  'Address',
  'City',
  'State',
  'Zip',
  'Phone',
  'Work Phone',
  'Email Address',
  'Title',
  'Department',
  'Building',
  'Embossed Number',
  'Token Unique',
  'Internal Number',
  'Download',
  'Token Status'
];

function sum(arr) {
  return arr.reduce((a, b) => a+b, 0);
}
function transpose(array) {
  return array[0].map(function(col, i) {
    return array.map(function(row) {
      return row[i];
    });
  });
}
let cnt = 0;
function correlation(method='percent', obj, threshold, pow=1, averaged=true) {
  if (method === 'percent') {
    threshold = threshold == undefined ? 0.1 : threshold;
  } else if (method === 'count') {
    threshold = threshold == undefined ? 1 : threshold;
  } else {
    throw new Error(`invalid method "${ method }"`);
  }
  let res = {};
  let vect = Object.keys(obj).sort((a, b) => obj[a].length > obj[b].length ? 1 : obj[b].length > obj[a].length ? -1 : 0);
  vect.sort((a, b) => {
    let [i, j] = [obj[a].length, obj[b].length];
    return i > j ? 1 : i < j ? -1 : 0;
  });
  let l = vect.length;
  let mat = [];
  for (let k=0; k<Math.pow(l, 2); k++) {
    let [i, j] = [k%l, Math.floor(k/l)];
    let value;
    if (i == j) {
      value = method === 'percent' ? 1 : 0;
      mat.push({ value, id: vect[i]+vect[j], x: i, y: j });
    } else if (i < j+1) {
      let [k1, k2] = [vect[i], vect[j]];
      let [a1, a2] = [obj[k1], obj[k2]];
      if (method === 'percent') {
        if (averaged) {
          let v = a1.reduce((acc, el) => acc + (a2.indexOf(el) > -1 ? 1 : 0), 0);
          value = (a1.length && a2.length) ? Math.pow((v/a1.length + v/a2.length)/2, pow) : 0;
          if (value > threshold) {
            mat.push({ value, id: vect[i]+vect[j], x: i, y: j });
            mat.push({ value, id: vect[j]+vect[i], x: j, y: i });
          }
        } else {
          let v = a1.reduce((acc, el) => acc + (a2.indexOf(el) > -1 ? 1 : 0), 0);
          value = (a1.length && a2.length) ? Math.pow(v/a1.length, pow) : 0;
          if (value > threshold) mat.push({ value, id: vect[j]+vect[i], x: j, y: i });
          value = (a1.length && a2.length) ? Math.pow(v/a2.length, pow) : 0;
          if (value > threshold) mat.push({ value, id: vect[i]+vect[j], x: i, y: j });
        }
      } else { // method == 'count'
        let v1 = a1.reduce((acc, el) => acc + (a2.indexOf(el) == -1 ? 1 : 0), 0);
        let v2 = a2.reduce((acc, el) => acc + (a1.indexOf(el) == -1 ? 1 : 0), 0);
        if (averaged) {
          value = Math.max(v1, v2);
          if (value <= threshold && value > 0) {
            mat.push({ value, id: vect[i]+vect[j], x: i, y: j });
            mat.push({ value, id: vect[j]+vect[i], x: j, y: i });
          }
        } else {
          if (v1 <= threshold) mat.push({ value: v1, id: vect[j]+vect[i], x: j, y: i });
          if (v2 <= threshold) mat.push({ value: v2, id: vect[i]+vect[j], x: i, y: j });
        }
      }
    }
  }
  return { vect, mat };
}

function createKeyMap(data) {
  let ob = {};
  for (let i=0; i<data.length; i++) {
    let { key } = data[i];
    ob[`Group${i+1}`] = key.split('\n');
  }
  return ob;
}

Observable.fromEvent(generateOutput, 'click').withLatestFrom(objects)
  .map(([e, arr]) => {
    let data = nest.entries(arr);
    let keyMap = createKeyMap(data);
    let defaults = getDefaults();
    arr = data.map(({ key, values }, j) => {
      let Roles = 'Group' + j;
      //if (Array.isArray(Roles)) Roles = Roles.join('|');
      return values.map(obj => Object.assign({}, defaults, obj.data, { Roles }));
    }).reduce((a, b) => a.concat(b), []);
    let keyText = Object.keys(keyMap).map(name => [name].concat(keyMap[name].join(','))).concat('', '').join('\r\n');
    let loadDate = new Date().toLocaleString();
    let rows = arr.map((data, i) => [
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
      ].map(v => v === undefined ? '' : v));
    if (includeHeaderCheckbox.checked) {
      rows.unshift(header);
    }
    let text = rows.map(row => row.map(JSON.stringify).join(',')).concat('').join('\r\n');
    let blob;
    if (includeKeymapCheckbox.checked) {
      blob = new Blob([keyText, text], { type: 'text/plain' });
    } else {
      blob = new Blob([text], { type: 'text/plain' });
    }
    return URL.createObjectURL(blob);
  })
  .subscribe(output => {
    downloadOutput.disabled = false;
    let fileName = outputFilenameInput.value || 'dump.csv';
    downloadOutput.setAttribute('download', fileName);
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
var container = svg.append('g');
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
//svg.call(zoom);

var labelsTopContainer = container.append('g').attr('class', 'labels-top');
var labelsTop = labelsTopContainer.selectAll('.label');
var labelsRightContainer = container.append('g').attr('class', 'labels-right');
var labelsRight = labelsRightContainer.selectAll('.label');
var labelsBottomContainer = container.append('g').attr('class', 'labels-bottom');
var labelsBottom = labelsBottomContainer.selectAll('.label');
var matrixContainer = container.append('g').attr('class', 'matrix');
var matrix = matrixContainer.selectAll('.row');

function draw(mat, xlabels, ylabels, sum) {
  let [ww, wh] = ['width', 'height'].map(s => svg.style(s)).map(v => +v.substring(0, v.length-2));
  let maxYLabel = ylabels.reduce((a, b) => b.length > a ? b.length : a, 0);
  let maxXLabel = xlabels.reduce((a, b) => b.length > a ? b.length : a, 0);
  let maxSum = sum.reduce((a, { value }) => value > a ? value : a, 0);

  let charWidth = 14;
  let charHeight = 14;

  let maxSideWidth = 80;
  let maxTopHeight = 80;
  let xlabelwidth = maxYLabel*charWidth;

  let sideWidth = Math.min(maxSideWidth, xlabelwidth);

  let colWidth = (ww - sideWidth)/xlabels.length;
  let xlabelheight = Math.sqrt(Math.pow(xlabelwidth, 2) - Math.pow(Math.min(colWidth, xlabelwidth), 2)) + charHeight;
  let xlabeltheta = (-Math.acos(Math.min(colWidth, xlabelwidth)/xlabelwidth))*180/Math.PI;
  let topHeight = Math.min(maxTopHeight, xlabelheight);
  let bottomHeight = 100;
  let rowHeight = (wh - topHeight - bottomHeight)/ylabels.length;

  let t = d3.transition().duration(200);
  labelsTop = labelsTop.data(xlabels, (d) => d);
  labelsTop.exit()
    .transition(t)
    .attr('transform', (d, i) => `translate(${ -ww }, ${ topHeight })`)
    .remove();

  let elabelsTop = labelsTop.enter()
    .append('g')
    .attr('class', 'label');
  elabelsTop.append('text');
  labelsTop = elabelsTop.merge(labelsTop);
  labelsTop
    .attr('transform', (d, i) => `translate(${ ww + i*colWidth }, ${ topHeight })`)
    .select('text')
    .attr('font-size', Math.min(rowHeight, charHeight))
    .attr('transform', `translate(0, ${ -charHeight }), rotate(${ xlabeltheta }), translate(0, ${ charHeight })`)
    .text(d => d.length > 10 ? d.substring(0, 10) + '...' : d);

  labelsTop
    .transition(t)
    .attr('transform', (d, i) => `translate(${ i*colWidth }, ${ topHeight })`)

  labelsRightContainer.attr('transform', `translate(${ ww - sideWidth }, ${ topHeight })`);
  labelsRight = labelsRight.data(ylabels, (d) => d);
  labelsRight.exit()
    .transition(t)
    .attr('transform', (d, i) => `translate(sideWidth, ${ i*rowHeight })`)
    .remove();

  let elabelsRight = labelsRight.enter()
    .append('g')
    .attr('class', 'label')
    .attr('transform', (d, i) => `translate(${ sideWidth }, ${ i*rowHeight })`)
  elabelsRight.append('text')
    .text((d) => d);
  labelsRight = elabelsRight.merge(labelsRight);
  labelsRight
    .select('text')
    .attr('font-size', Math.min(rowHeight, charHeight))
    .attr('y', Math.min(rowHeight, charHeight));

  labelsRight.transition(t)
    .attr('transform', (d, i) => `translate(0, ${ i*rowHeight })`)

  labelsBottomContainer.attr('transform', `translate(0, ${ wh - bottomHeight })`);
  labelsBottom = labelsBottom.data(sum, ({ key }) => key);
  labelsBottom.exit().remove();
  let elabelsBottom = labelsBottom.enter().append('g')
    .attr('transform', (d, i) => `translate(${ i*colWidth }, 0)`)
    .attr('class', 'label')
  elabelsBottom.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('stroke', 'white')
    .attr('stroke-width', 2)
    .attr('fill', 'black');
  labelsBottom = elabelsBottom.merge(labelsBottom);

  labelsBottom
    .transition().duration(100)
    .attr('transform', (d, i) => `translate(${ i*colWidth }, 0)`)
    .select('rect')
    .attr('width', colWidth)
    .attr('height', ({ value }) => (maxSum > 0 ? value / maxSum : 0)*bottomHeight)

  let matRows = d3.nest().key(d => d.y).entries(mat);
  matrixContainer.attr('transform', `translate(0, ${ topHeight })`);
  matrix = matrix.data(matRows, ({ key }) => key);
  matrix.exit().remove();
  let ematrix = matrix.enter()
    .append('g')
    .attr('class', 'row')
  ematrix.append('rect')
    .attr('class', 'back')
  matrix = ematrix.merge(matrix);
  matrix.select('.back')
    .attr('width', colWidth*xlabels.length)
    .attr('height', rowHeight)
  matrix.attr('transform', (d, i) => `translate(0, ${ i*rowHeight })`)

  let cols = matrix.selectAll('.col').data(({ values }) => values, ({ id }) => id);
  cols.exit().remove();
  let ecols = cols.enter().append('g').attr('class', 'col');
  ecols.append('rect')
    .attr('stroke', 'white')
    .attr('stroke-width', 2)
  ecols.append('title').text(d => d.id)
  cols = ecols.merge(cols);
  cols.attr('transform', (d) => `translate(${ d.x*colWidth }, 0)`)
    .select('rect')
    .attr('width', colWidth)
    .attr('height', rowHeight)
    .attr('fill', (d) => scolor(d.value))

}

var categories = container.selectAll('.cat');
function drawCategories(vect, keymap) {
  let { cat: { h: height, w: width, y: hpadding, x: wpadding }, mat: { w: rwidth, x: rwpadding }, ah, aw, unique } = getVals(vect, keymap);
  let th = height+hpadding;
  let tw = width+wpadding;

  matRows = matRows.data([])
  matRows.exit()
    .attr('opacity', 1)
    .transition().duration(500)
    .attr('transform', (d) => `translate(${ -d.key*th/ah*aw }, ${ +d.key*th })`)
    .transition().duration(500)
    .attr('opacity', 0)
    .attr('transform', ({ key }) => `scale(${ aw/rwidth }, 1), translate(${ -key*th/ah*aw }, ${ +key*th })`)
    .remove();

  let data = vect.map(key => ({ key, values: keymap[key] }));
  categories = categories.data(data, ({ key }) => key);

  categories.exit().remove();

  let ecats = categories.enter()
    .append('g')
    .attr('class', 'cat')
    .attr('transform', (d, i) => `translate(0, ${ i*(height+hpadding) }) scale(1, 1)`)

  categories = ecats.merge(categories);

  let cols = categories.selectAll('.col').data(d => d.values);
  cols.exit().remove();
  let ncols = cols.enter()
    .append('rect')
    .attr('class', 'col')

  cols = ncols.merge(cols);

  cols.attr('x', (d, i) => unique.indexOf(d)*(width + wpadding))
    .attr('width', (d) => width)
    .attr('height', height)

  categories
    .on('mouseenter', function(d) {
      d3.select(this).selectAll('.col').attr('fill', 'blue');
    })
    .on('mouseleave', function(d) {
      d3.select(this).selectAll('.col').attr('fill', 'black');
    });

  categories.transition().duration(100)
    .attr('transform', (d, i) => `translate(0, ${ i*(height+hpadding) })`)
    .select('rect')
    .attr('width', width)
    .attr('height', height)
   
  updateLabels(vect, aw, height, hpadding);
}

var matRows = container.selectAll('g.row')
var matSums = container.selectAll('.sum')
var labels = container.selectAll('.label')

/*
function exportRow(d) {
  let arr = [];
  let all = lastmat.filter(({y}) => y == d.y);
  for (let el of all) {
    let key = lastvect[el.x];
    arr.push([key, lastmap[key]]);
  }
  let unique = [];
  for (let each of arr.reduce((a, b) => a.concat(b[1]), [])) {
    if (unique.indexOf(each) == -1) {
      unique.push(each);
    }
  }
  let out = arr.map(v => v.slice(0,1));
  for (let j=0; j < unique.length; j++) {
    let c = unique[j];
    for (let k=0; k < out.length; k++) {
      out[k].push(arr[k][1].indexOf(c) > -1 ? c : '');
    }
  }
  let blob = new Blob([transpose(out).map(a => a.join(',')).join('\r\n')], { type: 'text/plain' });
  let url = URL.createObjectURL(blob);
  downloadOutput.setAttribute('download', 'selection.csv');
  downloadOutput.setAttribute('href', url);
  d3.event.stopPropagation();
}
*/

var scolor;
var hbottom = 4;
var wright = 4;
var toast = false;

function getUniqueFrom(vect, keymap) {
  // { [key] : [<string>, ... ], ... } => [<string>, ...]
  let c = {}; // counts
  for (let key of vect) {
    for (let col of keymap[key]) {
      c[col] = (c[col] || 0) + 1;
    }
  }
  return Object.keys(c).sort((a, b) => c[a] > c[b] ? 1 : c[b] > c[a] ? -1 : 0);
}


function getVals(vect, keymap, pf=1/6) {
 let [ww, wh] = [svg.style('width'), svg.style('height')].map(v => +v.substring(0, v.length-2));
 let maxlabellen = vect.reduce((a, b) => b.length > a ? b.length : a, 0)*14;
 let ah = hbottom/vect.length < 1 ? wh*(1-hbottom/vect.length) : wh;
 let aw = ww > maxlabellen ? ww - maxlabellen : ww;
 let cat = {}, mat = {};

 let unique = getUniqueFrom(vect, keymap);

 let l1 = vect.length
   , l2 = unique.length;
 let npf = 1 - pf;
 [mat.h, mat.y, mat.w, mat.x] = [ah/l1*npf, ah/l1*pf, aw/l1*npf, aw/l1*pf];
 [cat.h, cat.y, cat.w, cat.x] = [ah/l1*npf, ah/l1*pf, aw/l2*npf, aw/l2*pf];

 return { cat, mat, ah, aw, unique };
}

function sumMat(mat, row, dir=0) {
  return mat.filter(v => (dir ? (v.x > v.y) : (v.x < v.y)) && v.x == row).reduce((a, { value }) => a + value, 0);
}

function getPools(vect, mat, dir) {
  let pools = vect.map((id, i) => ({ id, value: sumMat(mat, i, dir) }));
  let max = pools.reduce((a, { value }) => value > a ? value : a, 0);
  return { pools, max };
}

function drawCorrelationMat(vect, mat, keymap, dir=0) {
  let { mat: { h: height, w: width, y: hpadding, x: wpadding }, ah, aw } = getVals(vect, keymap);
  let th = height+hpadding;
  let tw = width+wpadding;

  let { pools, max } = getPools(vect, mat, dir);

  let rows = d3.nest().key(d => d.y).entries(mat);

  categories = categories.data([])
  categories.exit()
    .transition().duration(500)
    .attr('transform', (d, i) => `translate(${ i*tw-aw/2 }, ${ i*th })`)
    .attr('opacity', 1.0)
    .transition().duration(500)
    .attr('transform', (d, i) => `translate(${ i*tw }, ${ i*th }) scale(0, 1)`)
    .attr('opacity', 0.0)
    .remove();

  matRows = matRows.data(rows, d => d.key);
  matRows.exit().remove();
  matRows = matRows.enter()
    .append('g')
    .attr('class', 'row')
    .attr('transform', ({ key }) => `translate(0, ${ +key*th })`)
    .merge(matRows)

  let rectGroup = matRows.selectAll('g.rect').data(d => d.values, ({ id }) => id);
  rectGroup.exit().remove();
  rectGroup.enter().append('g').attr('class', 'rect').append('rect')
    .attr('x', (d) => d.x*tw)
    .attr('width', width)
    .attr('height', height)
    .attr('fill', ({ value }) => scolor(value))

  rectGroup.select('rect').transition().duration(100).attr('x', ({ x }) => x*tw)
    .attr('width', width)
    .attr('height', height)
    .attr('fill', ({ value }) => scolor(value))

  matRows.transition().duration(100)
    .attr('transform', ({ key }) => `translate(0, ${ +key*th })`)

  matSums = matSums.data(pools, ({ id }) => id);
  matSums.exit().remove();

  let esums = matSums.enter()
    .append('g')
    .attr('class', 'sum')
    .attr('transform', (d, i) => `translate(${ i*tw }, ${ th*vect.length })`)

  esums.append('rect')
    .attr('width', width)
    .attr('height', ({value}) => max ? height*hbottom*value/max : 0)
    .attr('fill', 'black')

  esums.append('title')
    .text((d) => d.id)

  matSums = esums.merge(matSums);

  matSums.transition().duration(100)
    .attr('transform', (d, i) => `translate(${ i*tw }, ${ th*vect.length})`)
    .select('rect')
    .attr('width', width)
    .attr('height', ({value}) => max ? height*hbottom*value/max : 0)

  updateLabels(vect, aw, height, hpadding);
}

function updateLabels(vect, x, h, p, maxHeight=22) {
  labels = labels.data(vect, (v) => v)
  labels.exit().remove();

  let elabels = labels.enter()
    .append('g')
    .attr('class', 'label')

  elabels.append('text').attr('x', 0).text((d) => d);

  labels = elabels.merge(labels);

  labels
    .attr('transform', (d, i) => `translate(${ x }, ${ i*(h+p) })`)
    .select('text').attr('y', h).attr('font-size', Math.min(h, maxHeight));
}



function zoomed() {
  container.attr('transform', d3.event.transform);
}

const circleRadius = 14;
const borderRadius = 2;

function calcR(s) {
  return Math.sqrt(2*Math.sqrt(3)/Math.PI*s*Math.pow(circleRadius*1.3, 2));
}

var color = d3.interpolateBlues;

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

var node = container.append('g').selectAll('g');
var table = d3.select(document.body.querySelector('.table')).selectAll('.row');

let displayPhotosCheckbox = document.getElementById('display-photos');
function calculateGraph(people) {
  node = node.data(people, ({ id }) => id);
  table = table.data(people, ({ id }) => id);

  node.exit().remove()
  table.exit().remove()

  let nnode = node.enter().append('g')
    .attr('id', ({id}) => `blob-${ id }`)
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

  let ntable = table.enter().append('div').attr('data-id', ({ id }) => id);
  ntable.append('input').attr('type', 'checkbox').attr('id',  ({ id }) => 'item-' + id).on('change', function(d) {
    let checked = this.checked;
    let n = node.filter(`#blob-${ d.id }`).attr('selected', checked).select('circle');
    if (checked) {
      n.attr('fill', 'white');
    } else {
      n.attr('fill', () => color(+d.file))
    }
  });
  let tableRows = ntable.append('label').attr('for', ({ id }) => 'item-' + id)
    .on('mouseenter', function(d) {
      //this.classList.add('hover');
      node.style('opacity', 0.4);
      node.filter(`#blob-${ d.id }`).style('opacity', 1.0);
    })
    .on('mouseleave', function(d) {
      //this.classList.remove('hover');
      d3.select(this).style('class', null);
      node.style('opacity', 1.0);
    })

  tableRows
    .append('div')
    .attr('class', 'profile')
    .append('img')
    .attr('src', (d) => d.data.PhotoFile || 'assets/placeholder.png');

  tableRows
    .append('p')
    .text(({ data }) => [data['First Name'], data['Middle Name'], data['Last Name']].filter(s => s).join(' '));

  node = nnode.merge(node);
  table = ntable.merge(table);

  simulation.nodes(people);
  simulation.alpha(1.0).restart();
  reset();

  return node;
}

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
  d3.select(this).attr('selected', true).select('circle').attr('fill', 'white');
  node.style('opacity', function(d) {
    return (n === this) ? 1.0 : 0.4;
  });
  table.filter(`[data-id="${ d.id }"]`).each(function(e) {
    let sel = d3.select(this);
    if (e.id == d.id) {
      sel.select('input').attr('checked', true);
    }
    sel.select('label').each(function() {
      this.classList.add('hover');
      let p = this.parentElement.parentElement.parentElement;
      p.scrollTop = this.offsetTop - p.offsetHeight/3;
    });
  });
  d.fx = d.x;
  d.fy = d.y;
  node.filter('[selected=true]').each(function(e) {
    e.fx = d.x;
    e.fy = d.y;
  })

}


function dragged(d) {
  let { x, y } = event;
  d.fx = x;
  d.fy = y;
  node.filter('[selected=true]').each(function(e) {
    e.fx = x;
    e.fy = y;
  });
  reset();
}


function dragended(d) {
  if (!event.active) simulation.alphaTarget(1.0);
  d3.select(this).style('opacity', 1.0);
  d.fx = null;
  d.fy = null;
  node.filter('[selected=true]').each(function(e) {
    e.fx = null;
    e.fy = null;
  });
  node.style('opacity', 1.0);

  table.filter(`[data-id="${ d.id }"]`).select('label').each(function() {
    this.classList.remove('hover');
  });
}
