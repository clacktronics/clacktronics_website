# inception5h (vendored, trimmed)

- Model: `inception5h` — the GoogLeNet trained on ImageNet that Google's
  original DeepDream notebook used in July 2015
- Publisher: Google / The TensorFlow Authors
- Source: https://storage.googleapis.com/download.tensorflow.org/models/inception5h.zip
- sha256 of that zip: `d13569f6a98159de37e92e9c8ec4dae8f674fbf475f69fe6199b514f756d4364`
- Licence: Apache-2.0, Copyright 2015 The TensorFlow Authors (see `LICENSE`,
  copied verbatim out of the zip)

`graph.json` and `weights.bin` are **generated** — do not hand-edit them. They
are rebuilt by `scripts/build_inception5h_weights.py`, which needs numpy and
nothing else (a GraphDef is protobuf, and the script reads the few fields that
matter straight off the wire rather than pulling in TensorFlow).

What the script does, and why the files are the size they are:

- The upstream `tensorflow_inception_graph.pb` is 53.9 MB and holds the whole
  classifier: the convolutional trunk plus three classification heads. Nearly
  30 MB of it is `nn0_w`, `nn1_w` and the three `softmax*_w` matrices.
- DeepDream is gradient ascent on an *intermediate* activation, so it never
  runs a classifier head. The script walks the graph's dependency tree back
  from `mixed5b`, the end of the trunk, and keeps only what that reaches: 196
  ops and 114 weight tensors, 6.0 M parameters.
- Weights are stored fp16 and expanded to fp32 in the browser. Worst-case
  relative error is 4.6e-4, which is invisible after a picture has been
  dreamed over, and it halves the download to 12.1 MB. Gzip is not applied:
  binary floats compress by under a tenth, and `.htaccess` does not deflate
  `application/octet-stream` anyway.

The trimmed graph uses six op types — `Conv2D`, `BiasAdd`, `Relu`, `MaxPool`,
`LRN` and `Concat` — all of which have both a forward kernel and a registered
gradient in TensorFlow.js, which is what makes the effect possible at all.

Note on the training data: the weights are released by Google under Apache-2.0
and that is what is redistributed here. They were trained on ImageNet, whose
dataset terms are separate and do not attach to the released weights. The
ImageNet class balance — a great many dog breeds and birds — is exactly why
DeepDream grows dogs and birds out of clouds.
