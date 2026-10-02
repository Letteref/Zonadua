# Ride records for the prediction-accuracy gate

Every `*.json` file in this folder is read by
`src/lib/domain/__tests__/deviation.test.ts` on every `npm test` run.

The file is the gate for this DoD item:

> deviasi estimasi vs ride nyata di rute sama < ±7 %

**The box is still open.** No device has ever been attached to this project, so there
is nothing here yet. What exists is the instrument: drop in a real ride and the
ordinary test gate will predict it and fail if the estimate is more than 7 % off.

## The one rule

`"verified": true` means *a human did this ride on a bike and is vouching for the
numbers*. A file without it is still loaded and still printed — nothing is hidden — but
it does not count toward the pass/fail. That is deliberate: a demo ride dropped here by
accident should not be able to close the box.

The `verified` flag is not a technical claim. Nothing in the harness can check it, which
is exactly why it is separate from everything the harness can check.

## Producing a file

1. Ride a route you know. Record it on a head unit (Wahoo/Garmin/phone) and export the
   file. Take the **moving time**, not elapsed time.
2. Get the elevation profile of the same route. Any of:
   - export the GPX from the head unit and paste the `<trkpt>` lat/alt pairs;
   - export the GPX from Strava, or
   - open the route in GowsLab and read the profile off the route page.
   The profile only needs distance and elevation — the harness resamples it itself at
   100 m, so a point every 5 km is plenty.
3. Copy `../example-ride.json`, fill in your numbers, save it here under a descriptive
   name (`alpe-dhez-2026-09-14.json`).
4. Set `"verified": true` when the numbers are a real recording.
5. `npm test` — the deviation table prints on every run, pass or fail.

## What to fill in

| Field | Meaning | Where it comes from |
| --- | --- | --- |
| `rider.massKg` | rider body mass, kg | scale |
| `rider.bikeKg` | bike + shoes + bottles, kg | scale |
| `rider.crr` | rolling resistance | optional, defaults to 0.005 |
| `rider.cda` | frontal area m² | optional, defaults to 0.32 |
| `pacing` | what you actually aimed at | `{ "mode": "constant", "watts": 220 }` or `{ "mode": "if" }` |
| `actual.movingSec` | **moving** seconds, not elapsed | head unit |
| `actual.distanceKm` | distance, km | head unit |
| `profile[]` | `{ distKm, altM }` along the route | GPX |
| `verified` | your word that it is real | you |

## Why the gate is on the mean too

The gate has two halves: every individual ride within ±7 %, **and** the mean absolute
deviation across all verified rides within ±7 %. The second half is the one that matters.
A single easy route can be predicted well by accident; a set of rides that is
systematically wrong cannot have a small mean error while every ride stays inside the
band.

Deviations are taken as absolute values when averaging, so a set that is 10 % fast and
10 % slow does not cancel out to zero and look calibrated.

## If it fails

A failure is information, not a defect to be hidden by loosening the tolerance. The
usual causes, in the order worth checking:

- the profile is wrong (GPS altitude is noisier than the map's, especially in tunnels);
- `crr`/`cda` were never measured, so the default is doing the work;
- the ride was not ridden at constant power — a hilly route ridden "as hard as possible"
  is not a fair test of a constant-power projection, and the app has an `if` pacing mode
  precisely because nobody rides at constant power;
- the head unit's moving time excludes something your profile does not (a long
  descender pause still shows up as elevation in the route).