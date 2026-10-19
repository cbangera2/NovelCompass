"""Leave-one-out benchmark of synopsis->tag inference on NU novels from the published dataset.

    .venv/bin/python scripts/eval_tag_inference.py ~/Developer/novelcompass-data [--sample 1500]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.nlp.tag_inference import TagInferrer, embed_texts, load_corpus  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", type=Path)
    ap.add_argument("--sample", type=int, default=1500)
    ap.add_argument("--cache", type=Path, default=Path("/tmp/tag_inference_emb.npy"))
    args = ap.parse_args()
    ids, texts, tags, n_tags = load_corpus(args.data.expanduser())
    print(f"{len(ids)} NU novels with synopsis and >=5 tags", flush=True)

    if args.cache.exists() and np.load(args.cache).shape[0] == len(ids):
        emb = np.load(args.cache)
    else:
        emb = embed_texts(texts)
        np.save(args.cache, emb)
    from sklearn.feature_extraction.text import TfidfVectorizer
    tf = TfidfVectorizer(stop_words="english", min_df=3, max_df=0.3, sublinear_tf=True, ngram_range=(1, 2), max_features=200000)
    tfm = tf.fit_transform(texts)

    rng = np.random.default_rng(0)
    sample = rng.choice(len(ids), size=min(args.sample, len(ids)), replace=False)
    freq = np.zeros(n_tags)
    for t in tags:
        for x in t:
            freq[x] += 1
    prior = list(np.argsort(-freq)[:12])

    def run(name, infer):
        for k in (8, 12):
            p = r = 0.0
            for i in sample:
                truth = set(tags[i])
                got = infer(i, k)
                hit = len(truth & set(got))
                p += hit / k
                r += hit / len(truth)
            print(f"{name:28s} top{k:<2d} precision {p/len(sample):.3f}  recall {r/len(sample):.3f}", flush=True)

    run("popularity prior", lambda i, k: prior[:k])
    for nb, pw in ((25, 2.0), (50, 3.0), (100, 4.0)):
        inf = TagInferrer(emb, tags, n_tags, neighbours=nb, power=pw)
        run(f"embeddings k={nb} p={pw}", lambda i, k, inf=inf: inf.infer(emb[i], k, exclude=i))
    dense_tf = None
    def tf_infer(i, k, nb=25):
        sims = (tfm @ tfm[i].T).toarray().ravel()
        sims[i] = -1
        top = np.argpartition(-sims, nb)[:nb]
        inf = TagInferrer(emb, tags, n_tags)
        sc = {}
        for j in top:
            for t in tags[j]:
                sc[t] = sc.get(t, 0) + max(sims[j], 0) ** 2 * inf.idf[t]
        return [t for t, _ in sorted(sc.items(), key=lambda kv: -kv[1])[:k]]
    run("tf-idf k=25 p=2", tf_infer)


if __name__ == "__main__":
    main()
