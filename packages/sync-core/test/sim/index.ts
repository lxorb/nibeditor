/** The deterministic multi-device simulator of docs/sync-v2.md section 12, as a kit.
 *
 *  `simulate` runs a seed or a script; `AccountAdapter` and `DeviceAdapter` are where
 *  the Worker's routes and the app's engine plug in; the reference account and device
 *  are this package's rules and nothing else, which is what proves the kit before
 *  either real side exists. */

export { type Plant, ReferenceAccount, type Seeded } from './account'
export type {
  AccountAdapter,
  AccountView,
  Action,
  Answer,
  Classification,
  DeviceAdapter,
  EntryView,
  Held,
  Link,
  Pick,
  Route,
  View,
} from './adapters'
export { judge, type Ledger, ledger, markersIn, sameView } from './checks'
export { ReferenceDevice } from './device'
export { CALM, Clock, type Faults, Network, PATIENCE } from './network'
export { Random } from './random'
export { type Options, type Report, ROUGH, SEEDED, simulate, type Step } from './run'
