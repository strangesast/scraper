import { Observable } from 'rxjs';

export function reset() {}

// stores -> [{ name: , keyPath: }, ...]
export function init(dbName, version, stores, clear=false) {
  let request = indexedDB.open(dbName, version);

  let upgrade = Observable.fromEvent(request, 'upgradeneeded').pluck('target', 'result').map(db => {
    let storeNames = Array.from(db.objectStoreNames);
    for (let { name, keyPath, autoIncrement } of stores) {
      if (storeNames.indexOf(name) != -1) {
        db.deleteObjectStore(name);
      }
      db.createObjectStore(name, { keyPath, autoIncrement });
    }
    return db;
  });

  let success = Observable.fromEvent(request, 'success').pluck('target', 'result');

  if (clear) {
    success = success.flatMap(db => {
      let storeNames = stores.map(({ name }) => name);
      let trans = db.transaction(storeNames, 'readwrite');
      let requests = storeNames.map(name => trans.objectStore(name).clear());
      return Observable
        .forkJoin(requests.map(request => Observable.fromEvent(request, 'success').take(1)))
        .map(() => db);
    });
  }

  let failure = Observable.fromEvent(request, 'error')
    .pluck('target', 'error')
    .flatMap(err => Observable.throw(err));

  return Observable.merge(upgrade, success, failure).take(1); // take 1 probably unnecessary
};

export function save(db, storeName, objects) {
  let trans = db.transaction([storeName], 'readwrite');
  let store = trans.objectStore(storeName);

  if (Array.isArray(objects)) {
    return Observable.from(objects).concatMap(obj => {
      return saveToStore(store, obj);
    });

  } else {
    return saveToStore(store, objects);
  }
};

function saveToStore(store, object) {
  let request = store.put(object);
  let success = Observable.fromEvent(request, 'success').take(1)
    .pluck('target', 'result');
  let failure = Observable.fromEvent(request, 'error').take(1)
    .pluck('target', 'error')
    .flatMap(err => Observable.throw(err));
  return Observable.merge(success, failure).take(1);
}
