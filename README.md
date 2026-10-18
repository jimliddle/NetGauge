NetGauge is a privacy focused Network speed test client that tests against an M-Lab node and stores all runs in IndexedDb in the client's mobile browser. 

It is worth doing a second test run when you first start it as I notice the connection establishment means the first test run takes a hit.

It is possible to change themes to an Eink Theme that works well on Eink Devices such as Minimal Phone, LightPhone, Eink Tablets with web browser support etc.

The App is available directly as an installable PWA for a mobile browser at: https://jimliddle.github.io/NetGauge/

<img width="661" height="393" alt="Dark Theme" src="https://github.com/user-attachments/assets/151faa6d-ed5d-495c-b2b6-134b172913d4" />
<img width="661" height="393" alt="Eink Themee" src="https://github.com/user-attachments/assets/491574bf-c2d9-473f-8ce5-13091232728e" />



## Regression tests

Run `node --test tests/download.test.cjs` with Node.js 18 or newer. No dependencies are required.

These tests use simulated WebSocket events and clocks to cover successful downloads,
abrupt disconnects after data has arrived, empty/failed connections, timeout cleanup,
and continuation from an interrupted download to upload and the final result.

Download results use the bytes received through the last binary message, excluding
connection setup and teardown delays. In line with the [NDT7 protocol](https://github.com/m-lab/ndt-server/blob/main/spec/ndt7-protocol.md),
abrupt connection endings preserve measured results and log a warning. Connections
that receive no test data still fail with a descriptive error. Connection establishment
is limited to 10 seconds and the download phase to 13 seconds after opening.
