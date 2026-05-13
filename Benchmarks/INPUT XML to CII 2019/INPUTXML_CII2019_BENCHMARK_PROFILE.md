# CII 2019 Benchmark Profile

Benchmark files override generic Hexagon assumptions for this project profile.

Status: `PASS`

## Profile

```json
{
  "schema": "cii2019-benchmark-profile/v1",
  "benchmarkFileCount": 5,
  "rulePriority": [
    "observed_nonzero_benchmark_rows_per_block",
    "current_checker_fallback_for_unobserved_sections",
    "hexagon_reference_documentation_only"
  ],
  "sections": {
    "BEND": {
      "status": "observed",
      "linesPerBlock": 3,
      "source": "benchmark_corpus",
      "hexagonReference": 3,
      "currentCheckerFallback": 3
    },
    "RIGID": {
      "status": "observed",
      "linesPerBlock": 1,
      "source": "benchmark_corpus",
      "hexagonReference": 1,
      "currentCheckerFallback": 1
    },
    "EXPJT": {
      "status": "unobserved",
      "linesPerBlock": 1,
      "source": "fallback_current_checker_until_nonzero_benchmark_exists",
      "hexagonReference": 1
    },
    "RESTRANT": {
      "status": "observed",
      "linesPerBlock": 24,
      "source": "benchmark_corpus",
      "hexagonReference": 24,
      "currentCheckerFallback": 24
    },
    "DISPLMNT": {
      "status": "observed",
      "linesPerBlock": 20,
      "source": "benchmark_corpus",
      "hexagonReference": 20,
      "currentCheckerFallback": 20
    },
    "FORCMNT": {
      "status": "unobserved",
      "linesPerBlock": 13,
      "source": "fallback_current_checker_until_nonzero_benchmark_exists",
      "hexagonReference": 20
    },
    "UNIFORM": {
      "status": "unobserved",
      "linesPerBlock": 6,
      "source": "fallback_current_checker_until_nonzero_benchmark_exists",
      "hexagonReference": 6
    },
    "WIND": {
      "status": "unobserved",
      "linesPerBlock": 1,
      "source": "fallback_current_checker_until_nonzero_benchmark_exists",
      "hexagonReference": 1
    },
    "OFFSETS": {
      "status": "unobserved",
      "linesPerBlock": 1,
      "source": "fallback_current_checker_until_nonzero_benchmark_exists",
      "hexagonReference": 1
    },
    "ALLOWBLS": {
      "status": "observed",
      "linesPerBlock": 26,
      "source": "benchmark_corpus",
      "hexagonReference": 26,
      "currentCheckerFallback": 26
    },
    "SIF&TEES": {
      "status": "observed",
      "linesPerBlock": 10,
      "source": "benchmark_corpus",
      "hexagonReference": 10,
      "currentCheckerFallback": 10
    },
    "REDUCERS": {
      "status": "observed",
      "linesPerBlock": 1,
      "source": "benchmark_corpus",
      "hexagonReference": 1,
      "currentCheckerFallback": 1
    },
    "FLANGES": {
      "status": "observed",
      "linesPerBlock": 11,
      "source": "benchmark_corpus",
      "hexagonReference": 12,
      "currentCheckerFallback": 11
    },
    "EQUIPMNT": {
      "status": "observed",
      "linesPerBlock": 6,
      "source": "benchmark_corpus",
      "hexagonReference": 6,
      "currentCheckerFallback": 6
    }
  }
}
```

## Warnings

- FLANGES: benchmark observed 11, Hexagon reference says 12; benchmark profile overrides.

## Errors

- None

## Observations

| Section | File | CONTROL Count | Payload Rows | Observed Rows/Block | Status |
|---|---|---:|---:|---:|---|
| BEND | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 6 | 18 | 3 | observed |
| RIGID | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 6 | 6 | 1 | observed |
| EXPJT | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 0 | 0 |  | unobserved_zero_count |
| RESTRANT | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 2 | 48 | 24 | observed |
| DISPLMNT | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 3 | 60 | 20 | observed |
| FORCMNT | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 0 | 0 |  | unobserved_zero_count |
| UNIFORM | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 0 | 0 |  | unobserved_zero_count |
| WIND | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 0 | 0 |  | unobserved_zero_count |
| OFFSETS | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 0 | 0 |  | unobserved_zero_count |
| ALLOWBLS | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 1 | 26 | 26 | observed |
| SIF&TEES | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 1 | 10 | 10 | observed |
| REDUCERS | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 3 | 3 | 1 | observed |
| FLANGES | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 0 | 0 |  | unobserved_zero_count |
| EQUIPMNT | `Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY[BenchMark].CII` | 4 | 24 | 6 | observed |
| BEND | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 143 | 429 | 3 | observed |
| RIGID | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 174 | 174 | 1 | observed |
| EXPJT | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| RESTRANT | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 295 | 7080 | 24 | observed |
| DISPLMNT | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| FORCMNT | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| UNIFORM | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| WIND | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| OFFSETS | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| ALLOWBLS | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 42 | 1092 | 26 | observed |
| SIF&TEES | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 66 | 660 | 10 | observed |
| REDUCERS | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 19 | 19 | 1 | observed |
| FLANGES | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 2 | 22 | 11 | observed |
| EQUIPMNT | `Benchmarks/INPUT XML to CII 2019/5/AML-78-SYS-005-28-FEB-23_LATEST[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| BEND | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 26 | 78 | 3 | observed |
| RIGID | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 27 | 27 | 1 | observed |
| EXPJT | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| RESTRANT | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 26 | 624 | 24 | observed |
| DISPLMNT | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 2 | 40 | 20 | observed |
| FORCMNT | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| UNIFORM | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| WIND | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| OFFSETS | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| ALLOWBLS | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 2 | 52 | 26 | observed |
| SIF&TEES | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 5 | 50 | 10 | observed |
| REDUCERS | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 2 | 2 | 1 | observed |
| FLANGES | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| EQUIPMNT | `Benchmarks/INPUT XML to CII 2019/7/AML-78-SYS_007_08-03-2024[BENCHMARK}.CII` | 2 | 12 | 6 | observed |
| BEND | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 7 | 21 | 3 | observed |
| RIGID | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 15 | 15 | 1 | observed |
| EXPJT | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 0 | 0 |  | unobserved_zero_count |
| RESTRANT | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 8 | 192 | 24 | observed |
| DISPLMNT | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 0 | 0 |  | unobserved_zero_count |
| FORCMNT | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 0 | 0 |  | unobserved_zero_count |
| UNIFORM | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 0 | 0 |  | unobserved_zero_count |
| WIND | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 0 | 0 |  | unobserved_zero_count |
| OFFSETS | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 0 | 0 |  | unobserved_zero_count |
| ALLOWBLS | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 1 | 26 | 26 | observed |
| SIF&TEES | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 9 | 90 | 10 | observed |
| REDUCERS | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 0 | 0 |  | unobserved_zero_count |
| FLANGES | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 0 | 0 |  | unobserved_zero_count |
| EQUIPMNT | `Benchmarks/INPUT XML to CII 2019/BM_CII/BM_CII[Benchmark].CII` | 0 | 0 |  | unobserved_zero_count |
| BEND | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 11 | 33 | 3 | observed |
| RIGID | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 9 | 9 | 1 | observed |
| EXPJT | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| RESTRANT | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 5 | 120 | 24 | observed |
| DISPLMNT | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| FORCMNT | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| UNIFORM | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| WIND | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| OFFSETS | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| ALLOWBLS | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 1 | 26 | 26 | observed |
| SIF&TEES | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 9 | 90 | 10 | observed |
| REDUCERS | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| FLANGES | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
| EQUIPMNT | `Benchmarks/INPUT XML to CII 2019/INLET SEP/INLET-SEPARATOR-SKID-C2[BENCHMARK}.CII` | 0 | 0 |  | unobserved_zero_count |
