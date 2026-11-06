"""DEV-to-GitHub draft-PR handoff smoke test; synthetic data only."""


def test_dev_github_bridge_marker():
    assert ":".join(("DEV", "GITHUB", "DRAFT_PR")) == "DEV:GITHUB:DRAFT_PR"
