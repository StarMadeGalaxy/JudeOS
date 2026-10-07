#!/usr/bin/env python3
"""Verify published release, integrated source, tag CI and manifest identity."""
import argparse
import json
import os
import re
import urllib.parse
import urllib.request

REPO = "StarMadeGalaxy/JudeOS"
IMAGE = "ghcr.io/starmadegalaxy/judeos"
TAG = r"v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?"
REQUIRED = {"Go", "Web and contract", "Migrations", "Image and HTTPS", "Publish tagged release"}


class Rejected(ValueError):
    pass


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = urllib.parse.urlsplit(newurl).hostname
        if urllib.parse.urlsplit(newurl).scheme != "https" or host not in {
                "api.github.com", "github.com", "release-assets.githubusercontent.com"}:
            raise Rejected("unsafe_redirect")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if host != urllib.parse.urlsplit(req.full_url).hostname:
            redirected.remove_header("Authorization")
        return redirected


def fetch(url, asset=False):
    headers = {"User-Agent": "JudeOS-release-gate", "Accept": "application/vnd.github+json"}
    if not asset and os.environ.get("GH_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GH_TOKEN"]
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.build_opener(HTTPSRedirect()).open(request, timeout=30) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise Rejected("response_too_large")
    return json.loads(data)


def api(path):
    return fetch("https://api.github.com/repos/" + REPO + "/" + path)


def verify(tag, digest=None, run_id=None, get=api, download=None):
    if not isinstance(tag, str) or not re.fullmatch(TAG, tag):
        raise Rejected("invalid_tag")
    release = get("releases/tags/" + tag)
    if release.get("draft") is not False or release.get("tag_name") != tag:
        raise Rejected("unpublished_release")
    assets = [a for a in release.get("assets", []) if a.get("name") == "release.json" and a.get("state") == "uploaded"]
    if len(assets) != 1:
        raise Rejected("manifest_missing")
    url = "https://github.com/" + REPO + "/releases/download/" + tag + "/release.json"
    data = (download or (lambda u: fetch(u, asset=True)))(url)
    if not isinstance(data, dict):
        raise Rejected("invalid_manifest")
    sha = data.get("source_commit", "")
    image = data.get("registry_digest", "")
    if (data.get("dirty") is not False or data.get("rebuild_verified") is not True
            or data.get("platform") != "linux/amd64" or data.get("release_tag") != tag
            or not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha)
            or not isinstance(image, str) or not re.fullmatch(re.escape(IMAGE) + r"@sha256:[0-9a-f]{64}", image)
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(data.get("local_image_id", "")))
            or not isinstance(data.get("schema_version"), int) or isinstance(data.get("schema_version"), bool)
            or data["schema_version"] < 1
            or not isinstance(data.get("migrations"), dict) or not data["migrations"]
            or any(not isinstance(k, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+\.sql", k)
                   or not isinstance(v, str) or not re.fullmatch(r"[0-9a-f]{64}", v)
                   for k, v in data["migrations"].items())):
        raise Rejected("invalid_manifest")
    if digest is not None and image != IMAGE + "@" + digest:
        raise Rejected("digest_mismatch")
    obj = get("git/ref/tags/" + tag)["object"]
    for _ in range(5):
        if obj.get("type") == "commit":
            break
        if obj.get("type") != "tag" or not re.fullmatch(r"[0-9a-f]{40}", str(obj.get("sha", ""))):
            raise Rejected("invalid_tag_object")
        obj = get("git/tags/" + obj["sha"])["object"]
    if obj.get("type") != "commit" or obj.get("sha") != sha:
        raise Rejected("tag_manifest_mismatch")
    if get("compare/" + sha + "...main").get("status") not in {"ahead", "identical"}:
        raise Rejected("source_not_integrated")
    workflow = get("actions/workflows/ci.yml")
    if workflow.get("path") != ".github/workflows/ci.yml":
        raise Rejected("wrong_workflow")
    if run_id is not None:
        if not str(run_id).isdigit():
            raise Rejected("invalid_run")
        runs = [get("actions/runs/" + str(run_id))]
    else:
        runs = get(f'actions/workflows/{workflow["id"]}/runs?event=push&head_sha={sha}&status=success&per_page=100')["workflow_runs"]
    for run in runs:
        if (run.get("workflow_id") != workflow["id"] or run.get("event") != "push"
                or run.get("head_sha") != sha or run.get("head_branch") != tag
                or run.get("conclusion") != "success"
                or run.get("head_repository", {}).get("full_name") != REPO):
            continue
        attempt = run.get("run_attempt")
        if not isinstance(attempt, int) or attempt < 1 or not isinstance(run.get("id"), int):
            continue
        jobs = get(f'actions/runs/{run["id"]}/attempts/{attempt}/jobs?per_page=100')["jobs"]
        successful = {j.get("name") for j in jobs if j.get("conclusion") == "success"}
        if REQUIRED <= successful:
            return data
    raise Rejected("verified_tag_ci_missing")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--tag", required=True)
    p.add_argument("--run-id", type=int)
    p.add_argument("--digest")
    a = p.parse_args()
    try:
        data = verify(a.tag, a.digest, a.run_id)
    except (OSError, ValueError, KeyError, TypeError):
        p.exit(2, "Release gate failed: require published manifest, integrated tag and successful tag CI.\n")
    print(json.dumps({"tag": data["release_tag"], "digest": data["registry_digest"].split("@", 1)[1],
                      "source_commit": data["source_commit"], "verified": True}))


if __name__ == "__main__":
    main()
