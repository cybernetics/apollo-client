import * as chai from 'chai';
const { assert } = chai;
import * as sinon from 'sinon';

import gql from 'graphql-tag';

import mockQueryManager from './mocks/mockQueryManager';
import mockWatchQuery from './mocks/mockWatchQuery';
import { ObservableQuery } from '../src/core/ObservableQuery';

import wrap from './util/wrap';
import subscribeAndCount from './util/subscribeAndCount';

describe('ObservableQuery', () => {
  // Standard data for all these tests
  const query = gql`
    query($id: ID!) {
      people_one(id: $id) {
        name
      }
    }
  `;
  const superQuery = gql`
    query($id: ID!) {
      people_one(id: $id) {
        name
        age
      }
    }
  `;
  const variables = { id: 1 };
  const differentVariables = { id: 2 };
  const dataOne = {
    people_one: {
      name: 'Luke Skywalker',
    },
  };
  const superDataOne = {
    people_one: {
      name: 'Luke Skywalker',
      age: 21,
    },
  };
  const dataTwo = {
    people_one: {
      name: 'Leia Skywalker',
    },
  };


  describe('setOptions', () => {
    describe('to change pollInterval', () => {
      let timer: any;
      // We need to use this to jump over promise.then boundaries
      let defer: Function = setImmediate;
      beforeEach(() => timer = sinon.useFakeTimers());
      afterEach(() => timer.restore());

      it('starts polling if goes from 0 -> something', (done) => {
        const manager = mockQueryManager({
          request: { query, variables },
          result: { data: dataOne },
        }, {
          request: { query, variables },
          result: { data: dataTwo },
        });

        const observable = manager.watchQuery({ query, variables });
        subscribeAndCount(done, observable, (handleCount, result) => {
          if (handleCount === 1) {
            assert.deepEqual(result.data, dataOne);
            observable.setOptions({ pollInterval: 10 });
            // 10 for the poll and an extra 1 for network requests
            timer.tick(11);
          } else if (handleCount === 2) {
            assert.deepEqual(result.data, dataTwo);
            done();
          }
        });

        // trigger the first subscription callback
        timer.tick(0);
      });

      it('stops polling if goes from something -> 0', (done) => {
        const manager = mockQueryManager({
          request: { query, variables },
          result: { data: dataOne },
        }, {
          request: { query, variables },
          result: { data: dataTwo },
        });

        const observable = manager.watchQuery({
          query,
          variables,
          pollInterval: 10,
        });
        subscribeAndCount(done, observable, (handleCount, result) => {
          if (handleCount === 1) {
            assert.deepEqual(result.data, dataOne);
            observable.setOptions({ pollInterval: 0 });

            // big number just to be sure
            timer.tick(100);
            done();
          } else if (handleCount === 2) {
            done(new Error('Should not get more than one result'));
          }
        });

        // trigger the first subscription callback
        timer.tick(0);
      });

      it('can change from x>0 to y>0', (done) => {
        const manager = mockQueryManager({
          request: { query, variables },
          result: { data: dataOne },
        }, {
          request: { query, variables },
          result: { data: dataTwo },
        });

        const observable = manager.watchQuery({
          query,
          variables,
          pollInterval: 100,
        });
        subscribeAndCount(done, observable, (handleCount, result) => {
          if (handleCount === 1) {
            assert.deepEqual(result.data, dataOne);

            // It's confusing but we need to ensure we let the scheduler
            // come back from fetching before we mess with it.
            defer(() => {
              observable.setOptions({ pollInterval: 10 });

              // Again, the scheduler needs to complete setting up the poll
              // before the timer goes off
              defer(() => {
                // just enough to trigger a second data
                timer.tick(11);
              });
            });

          } else if (handleCount === 2) {
            assert.deepEqual(result.data, dataTwo);
            done();
          }
        });

        // trigger the first subscription callback
        timer.tick(0);
      });
    });

    it('does a network request if forceFetch becomes true', (done) => {
      const observable: ObservableQuery = mockWatchQuery({
        request: { query, variables },
        result: { data: dataOne },
      }, {
        request: { query, variables },
        result: { data: dataTwo },
      });

      subscribeAndCount(done, observable, (handleCount, result) => {
        if (handleCount === 1) {
          assert.deepEqual(result.data, dataOne);
          observable.setOptions({ forceFetch: true });
        } else if (handleCount === 2) {
          assert.deepEqual(result.data, dataTwo);
          done();
        }
      });
    });
  });

  describe('setVariables', () => {
    it('reruns query if the variables change', (done) => {
      const observable: ObservableQuery = mockWatchQuery({
        request: { query, variables },
        result: { data: dataOne },
      }, {
        request: { query, variables: differentVariables },
        result: { data: dataTwo },
      });

      subscribeAndCount(done, observable, (handleCount, result) => {
        if (handleCount === 1) {
          assert.deepEqual(result.data, dataOne);
          observable.setVariables(differentVariables);
        } else if (handleCount === 2) {
          assert.isTrue(result.loading);
          assert.deepEqual(result.data, dataOne);
        } else if (handleCount === 3) {
          assert.isFalse(result.loading);
          assert.deepEqual(result.data, dataTwo);
          done();
        }
      });
    });

    it('reruns observer callback if the variables change but data does not', (done) => {
      const observable: ObservableQuery = mockWatchQuery({
        request: { query, variables },
        result: { data: dataOne },
      }, {
        request: { query, variables: differentVariables },
        result: { data: dataOne },
      });

      subscribeAndCount(done, observable, (handleCount, result) => {
        if (handleCount === 1) {
          assert.deepEqual(result.data, dataOne);
          observable.setVariables(differentVariables);
        } else if (handleCount === 2) {
          assert.isTrue(result.loading);
          assert.deepEqual(result.data, dataOne);
        } else if (handleCount === 3) {
          assert.deepEqual(result.data, dataOne);
          done();
        }
      });
    });

    it('does not rerun observer callback if the variables change but new data is in store', (done) => {
      const manager = mockQueryManager({
        request: { query, variables },
        result: { data: dataOne },
      }, {
        request: { query, variables: differentVariables },
        result: { data: dataOne },
      });

      manager.query({ query, variables: differentVariables })
        .then(() => {
          const observable: ObservableQuery = manager.watchQuery({ query, variables });

          let errored = false;
          subscribeAndCount(done, observable, (handleCount, result) => {
            if (handleCount === 1) {
              assert.deepEqual(result.data, dataOne);
              observable.setVariables(differentVariables);

              // Nothing should happen, so we'll wait a moment to check that
              setTimeout(() => !errored && done(), 10);
            } else if (handleCount === 2) {
              errored = true;
              throw new Error('Observable callback should not fire twice');
            }
          });
        });
    });

    it('does not rerun query if variables do not change', (done) => {
      const observable: ObservableQuery = mockWatchQuery({
        request: { query, variables },
        result: { data: dataOne },
      }, {
        request: { query, variables },
        result: { data: dataTwo },
      });

      let errored = false;
      subscribeAndCount(done, observable, (handleCount, result) => {
        if (handleCount === 1) {
          assert.deepEqual(result.data, dataOne);
          observable.setVariables(variables);

          // Nothing should happen, so we'll wait a moment to check that
          setTimeout(() => !errored && done(), 10);
        } else if (handleCount === 2) {
          errored = true;
          throw new Error('Observable callback should not fire twice');
        }
      });
    });
  });

  describe('currentResult', () => {
    it('returns the current query status immediately', (done) => {
      const observable: ObservableQuery = mockWatchQuery({
        request: { query, variables },
        result: { data: dataOne },
        delay: 100,
      });

      subscribeAndCount(done, observable, () => {
        assert.deepEqual(observable.currentResult(), {
          data: dataOne,
          loading: false,
        });
        done();
      });

      assert.deepEqual(observable.currentResult(), {
        loading: true,
        data: {},
      });
      setTimeout(wrap(done, () => {
        assert.deepEqual(observable.currentResult(), {
          loading: true,
          data: {},
        });
      }), 0);
    });

    it('returns results from the store immediately', () => {
      const queryManager = mockQueryManager({
        request: { query, variables },
        result: { data: dataOne },
      });

      return queryManager.query({ query, variables })
        .then((result: any) => {
          assert.deepEqual(result, {
            data: dataOne,
            loading: false,
          });

          const observable = queryManager.watchQuery({
            query,
            variables,
          });
          assert.deepEqual(observable.currentResult(), {
            data: dataOne,
            loading: false,
          });
        });
    });

    it('returns partial data from the store immediately', (done) => {
      const queryManager = mockQueryManager({
        request: { query, variables },
        result: { data: dataOne },
      }, {
        request: { query: superQuery, variables },
        result: { data: superDataOne },
      });

      queryManager.query({ query, variables })
        .then((result: any) => {
          const observable = queryManager.watchQuery({
            query: superQuery,
            variables,
            returnPartialData: true,
          });
          assert.deepEqual(observable.currentResult(), {
            data: dataOne,
            loading: true,
          });

          // we can use this to trigger the query
          subscribeAndCount(done, observable, (handleCount, subResult) => {
            assert.deepEqual(subResult, observable.currentResult());

            if (handleCount === 1) {
              assert.deepEqual(subResult, {
                data: dataOne,
                loading: true,
              });
            } else if (handleCount === 2) {
              assert.deepEqual(subResult, {
                data: superDataOne,
                loading: false,
              });
              done();
            }
          });
        });
    });

    it('returns loading even if full data is available when force fetching', (done) => {
      const queryManager = mockQueryManager({
        request: { query, variables },
        result: { data: dataOne },
      }, {
        request: { query, variables },
        result: { data: dataTwo },
      });

      queryManager.query({ query, variables })
        .then((result: any) => {
          const observable = queryManager.watchQuery({
            query,
            variables,
            forceFetch: true,
          });
          assert.deepEqual(observable.currentResult(), {
            data: dataOne,
            loading: true,
          });

          subscribeAndCount(done, observable, (handleCount, subResult) => {
            assert.deepEqual(subResult, observable.currentResult());

            if (handleCount === 1) {
              assert.deepEqual(subResult, {
                data: dataTwo,
                loading: false,
              });
              done();
            }
          });
        });
    });
  });
});
