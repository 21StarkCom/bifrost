// A real `gh api graphql` answer for 21StarkCom/bifrost #446 (merged) and #447 (a draft, its `ci` run
// in progress), from githubQuery, on 2026-11-01. Only the tests import it.
export const ANSWER = {
  "data": {
    "repository": {
      "p446": {
        "number": 446,
        "title": "feat(STARK-14683): group the Gru pane's ticket list and color each state",
        "state": "MERGED",
        "isDraft": false,
        "createdAt": "2026-11-01T14:02:00Z",
        "mergedAt": "2026-11-01T14:17:01Z",
        "closedAt": "2026-11-01T14:17:01Z",
        "additions": 681,
        "deletions": 120,
        "url": "https://github.com/21StarkCom/bifrost/pull/446",
        "commits": {
          "totalCount": 3,
          "nodes": [
            {
              "commit": {
                "abbreviatedOid": "93e99f3",
                "messageHeadline": "feat(STARK-14683): group the Gru pane's ticket list and color each state",
                "authoredDate": "2026-11-01T13:57:12Z",
                "statusCheckRollup": null
              }
            },
            {
              "commit": {
                "abbreviatedOid": "525db81",
                "messageHeadline": "fix(STARK-14683): review round: verdict age, dead calls, heartbeat ow…",
                "authoredDate": "2026-11-01T14:09:32Z",
                "statusCheckRollup": null
              }
            },
            {
              "commit": {
                "abbreviatedOid": "0966587",
                "messageHeadline": "chore(changelog): stark-progress 0.13.0: the Gru pane groups tickets …",
                "authoredDate": "2026-11-01T14:14:14Z",
                "statusCheckRollup": {
                  "state": "SUCCESS"
                }
              }
            }
          ]
        },
        "head": {
          "nodes": [
            {
              "commit": {
                "checkSuites": {
                  "nodes": [
                    {
                      "status": "QUEUED",
                      "conclusion": null,
                      "workflowRun": null,
                      "checkRuns": {
                        "nodes": []
                      }
                    },
                    {
                      "status": "QUEUED",
                      "conclusion": null,
                      "workflowRun": null,
                      "checkRuns": {
                        "nodes": []
                      }
                    },
                    {
                      "status": "COMPLETED",
                      "conclusion": "SUCCESS",
                      "workflowRun": {
                        "runNumber": 1278,
                        "url": "https://github.com/21StarkCom/bifrost/actions/runs/41315189353",
                        "createdAt": "2026-11-01T14:14:22Z",
                        "updatedAt": "2026-11-01T14:16:05Z",
                        "workflow": {
                          "name": "ci"
                        }
                      },
                      "checkRuns": {
                        "nodes": [
                          {
                            "name": "test",
                            "status": "COMPLETED",
                            "conclusion": "SUCCESS",
                            "startedAt": "2026-11-01T14:14:25Z",
                            "completedAt": "2026-11-01T14:16:04Z"
                          },
                          {
                            "name": "actionlint",
                            "status": "COMPLETED",
                            "conclusion": "SUCCESS",
                            "startedAt": "2026-11-01T14:14:25Z",
                            "completedAt": "2026-11-01T14:15:01Z"
                          },
                          {
                            "name": "secret scan (tree)",
                            "status": "COMPLETED",
                            "conclusion": "SUCCESS",
                            "startedAt": "2026-11-01T14:14:24Z",
                            "completedAt": "2026-11-01T14:14:31Z"
                          },
                          {
                            "name": "typecheck",
                            "status": "COMPLETED",
                            "conclusion": "SUCCESS",
                            "startedAt": "2026-11-01T14:14:25Z",
                            "completedAt": "2026-11-01T14:14:37Z"
                          }
                        ]
                      }
                    },
                    {
                      "status": "COMPLETED",
                      "conclusion": "SUCCESS",
                      "workflowRun": {
                        "runNumber": 580,
                        "url": "https://github.com/21StarkCom/bifrost/actions/runs/41315189829",
                        "createdAt": "2026-11-01T14:14:22Z",
                        "updatedAt": "2026-11-01T14:14:37Z",
                        "workflow": {
                          "name": "secret-scan"
                        }
                      },
                      "checkRuns": {
                        "nodes": [
                          {
                            "name": "secret-scan / secret-scan",
                            "status": "COMPLETED",
                            "conclusion": "SUCCESS",
                            "startedAt": "2026-11-01T14:14:25Z",
                            "completedAt": "2026-11-01T14:14:36Z"
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          ]
        },
        "mergeCommit": {
          "abbreviatedOid": "63621a7",
          "checkSuites": {
            "nodes": [
              {
                "status": "QUEUED",
                "conclusion": null,
                "workflowRun": null,
                "checkRuns": {
                  "nodes": []
                }
              },
              {
                "status": "QUEUED",
                "conclusion": null,
                "workflowRun": null,
                "checkRuns": {
                  "nodes": []
                }
              },
              {
                "status": "COMPLETED",
                "conclusion": "SUCCESS",
                "workflowRun": {
                  "runNumber": 1279,
                  "url": "https://github.com/21StarkCom/bifrost/actions/runs/41315419231",
                  "createdAt": "2026-11-01T14:17:04Z",
                  "updatedAt": "2026-11-01T14:18:44Z",
                  "workflow": {
                    "name": "ci"
                  }
                },
                "checkRuns": {
                  "nodes": [
                    {
                      "name": "actionlint",
                      "status": "COMPLETED",
                      "conclusion": "SUCCESS",
                      "startedAt": "2026-11-01T14:17:07Z",
                      "completedAt": "2026-11-01T14:17:36Z"
                    },
                    {
                      "name": "typecheck",
                      "status": "COMPLETED",
                      "conclusion": "SUCCESS",
                      "startedAt": "2026-11-01T14:17:06Z",
                      "completedAt": "2026-11-01T14:17:16Z"
                    },
                    {
                      "name": "secret scan (tree)",
                      "status": "COMPLETED",
                      "conclusion": "SUCCESS",
                      "startedAt": "2026-11-01T14:17:06Z",
                      "completedAt": "2026-11-01T14:17:12Z"
                    },
                    {
                      "name": "test",
                      "status": "COMPLETED",
                      "conclusion": "SUCCESS",
                      "startedAt": "2026-11-01T14:17:07Z",
                      "completedAt": "2026-11-01T14:18:44Z"
                    }
                  ]
                }
              },
              {
                "status": "COMPLETED",
                "conclusion": "SUCCESS",
                "workflowRun": {
                  "runNumber": 581,
                  "url": "https://github.com/21StarkCom/bifrost/actions/runs/41315419692",
                  "createdAt": "2026-11-01T14:17:04Z",
                  "updatedAt": "2026-11-01T14:17:18Z",
                  "workflow": {
                    "name": "secret-scan"
                  }
                },
                "checkRuns": {
                  "nodes": [
                    {
                      "name": "secret-scan / secret-scan",
                      "status": "COMPLETED",
                      "conclusion": "SUCCESS",
                      "startedAt": "2026-11-01T14:17:07Z",
                      "completedAt": "2026-11-01T14:17:17Z"
                    }
                  ]
                }
              }
            ]
          }
        }
      },
      "p447": {
        "number": 447,
        "title": "feat(STARK-14709): the epic's title and start on the Gru pane, and session and working time in Stats",
        "state": "OPEN",
        "isDraft": true,
        "createdAt": "2026-11-01T14:41:15Z",
        "mergedAt": null,
        "closedAt": null,
        "additions": 275,
        "deletions": 26,
        "url": "https://github.com/21StarkCom/bifrost/pull/447",
        "commits": {
          "totalCount": 1,
          "nodes": [
            {
              "commit": {
                "abbreviatedOid": "5e09724",
                "messageHeadline": "feat(STARK-14709): the epic's title and start on the Gru pane, and se…",
                "authoredDate": "2026-11-01T14:40:55Z",
                "statusCheckRollup": {
                  "state": "PENDING"
                }
              }
            }
          ]
        },
        "head": {
          "nodes": [
            {
              "commit": {
                "checkSuites": {
                  "nodes": [
                    {
                      "status": "QUEUED",
                      "conclusion": null,
                      "workflowRun": null,
                      "checkRuns": {
                        "nodes": []
                      }
                    },
                    {
                      "status": "QUEUED",
                      "conclusion": null,
                      "workflowRun": null,
                      "checkRuns": {
                        "nodes": []
                      }
                    },
                    {
                      "status": "IN_PROGRESS",
                      "conclusion": null,
                      "workflowRun": {
                        "runNumber": 1280,
                        "url": "https://github.com/21StarkCom/bifrost/actions/runs/41317425999",
                        "createdAt": "2026-11-01T14:41:18Z",
                        "updatedAt": "2026-11-01T14:41:22Z",
                        "workflow": {
                          "name": "ci"
                        }
                      },
                      "checkRuns": {
                        "nodes": [
                          {
                            "name": "secret scan (tree)",
                            "status": "COMPLETED",
                            "conclusion": "SUCCESS",
                            "startedAt": "2026-11-01T14:41:21Z",
                            "completedAt": "2026-11-01T14:41:29Z"
                          },
                          {
                            "name": "test",
                            "status": "IN_PROGRESS",
                            "conclusion": null,
                            "startedAt": "2026-11-01T14:41:21Z",
                            "completedAt": null
                          },
                          {
                            "name": "actionlint",
                            "status": "COMPLETED",
                            "conclusion": "SUCCESS",
                            "startedAt": "2026-11-01T14:41:21Z",
                            "completedAt": "2026-11-01T14:41:55Z"
                          },
                          {
                            "name": "typecheck",
                            "status": "COMPLETED",
                            "conclusion": "SUCCESS",
                            "startedAt": "2026-11-01T14:41:21Z",
                            "completedAt": "2026-11-01T14:41:29Z"
                          }
                        ]
                      }
                    },
                    {
                      "status": "COMPLETED",
                      "conclusion": "SUCCESS",
                      "workflowRun": {
                        "runNumber": 582,
                        "url": "https://github.com/21StarkCom/bifrost/actions/runs/41317426289",
                        "createdAt": "2026-11-01T14:41:19Z",
                        "updatedAt": "2026-11-01T14:41:30Z",
                        "workflow": {
                          "name": "secret-scan"
                        }
                      },
                      "checkRuns": {
                        "nodes": [
                          {
                            "name": "secret-scan / secret-scan",
                            "status": "COMPLETED",
                            "conclusion": "SUCCESS",
                            "startedAt": "2026-11-01T14:41:21Z",
                            "completedAt": "2026-11-01T14:41:29Z"
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          ]
        },
        "mergeCommit": null
      }
    }
  }
}
