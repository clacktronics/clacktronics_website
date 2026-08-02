"""Turn Google's frozen inception5h graph into the pair of files ClackPaint's
DeepDream effect loads in the browser.

The upstream artefact is a 53.9 MB TensorFlow 1 GraphDef holding the whole
GoogLeNet used by the original 2015 DeepDream notebook, classifier heads and
all.  DeepDream only ever runs the convolutional trunk, so this script walks
the graph's dependency tree back from `mixed5b`, drops the three classifier
heads (nearly 30 MB of the file), rewrites what is left as a small JSON
description plus one flat fp16 blob, and copies the upstream LICENSE next to
them.

Nothing here needs TensorFlow: a GraphDef is protobuf, and the handful of
fields DeepDream cares about are read straight off the wire below.  numpy is
required only when regenerating the files, not by the website.

    python3 scripts/build_inception5h_weights.py

Weights are stored as fp16 (worst-case relative error 4.6e-4, invisible once a
picture has been dreamed over) and expanded to fp32 in the browser.  Storing
them as fp32 would double the download for no visible gain; gzip is not worth
the trouble either, as binary floats compress by less than a tenth.
"""

import hashlib
import io
import json
import struct
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "vendor" / "inception5h"
SOURCE_URL = "https://storage.googleapis.com/download.tensorflow.org/models/inception5h.zip"
# sha256 of the zip this script was written against; a mismatch means the
# upstream artefact moved and the output should not be trusted blindly.
SOURCE_SHA256 = "d13569f6a98159de37e92e9c8ec4dae8f674fbf475f69fe6199b514f756d4364"

# The last layer we keep.  mixed5b is the end of the trunk: everything after it
# in the graph is classification, which gradient ascent never touches.
CUT = "mixed5b"
# The original notebook subtracts a flat ImageNet mean and does no scaling.
IMAGENET_MEAN = 117.0


# ----------------------------------------------------------- protobuf reading

def _varint(buf, i):
    result = shift = 0
    while True:
        byte = buf[i]
        i += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, i
        shift += 7


def _fields(buf, start, end):
    """Yield (field number, value, payload start, payload end) over one message.

    Varints arrive as the value with no payload; length-delimited, 32-bit and
    64-bit fields arrive as a payload range with no value.
    """
    i = start
    while i < end:
        key, i = _varint(buf, i)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, i = _varint(buf, i)
            yield number, value, None, None
        elif wire == 2:
            length, i = _varint(buf, i)
            yield number, None, i, i + length
            i += length
        elif wire == 5:
            yield number, None, i, i + 4
            i += 4
        elif wire == 1:
            yield number, None, i, i + 8
            i += 8
        else:
            raise ValueError(f"unsupported wire type {wire}")


def _packed_varints(buf, start, end):
    values, i = [], start
    while i < end:
        value, i = _varint(buf, i)
        values.append(value)
    return values


def _attr_value(buf, start, end):
    """One AttrValue: the string, int, float, list-of-ints or tensor cases."""
    attr = {}
    for number, value, payload, payload_end in _fields(buf, start, end):
        if number == 1:  # ListValue
            ints = []
            for f, v, s, e in _fields(buf, payload, payload_end):
                if f == 3:
                    ints.extend([v] if s is None else _packed_varints(buf, s, e))
            attr["list_i"] = ints
        elif number == 2:
            attr["s"] = buf[payload:payload_end].decode()
        elif number == 3:
            attr["i"] = value
        elif number == 4:
            attr["f"] = float(struct.unpack("<f", buf[payload:payload_end])[0])
        elif number == 8:
            attr["tensor"] = (payload, payload_end)
    return attr


def _tensor(buf, start, end):
    """One TensorProto, as (dtype, shape, float array)."""
    dtype, shape, content, int_vals, float_vals = 1, [], None, [], []
    for number, value, payload, payload_end in _fields(buf, start, end):
        if number == 1:
            dtype = value
        elif number == 2:  # TensorShapeProto
            dims = []
            for f, v, s, e in _fields(buf, payload, payload_end):
                if f == 2:  # Dim
                    for f2, v2, s2, e2 in _fields(buf, s, e):
                        if f2 == 1:
                            dims.append(v2)
            shape = dims
        elif number == 4:
            content = (payload, payload_end)
        elif number == 5:
            float_vals.append(struct.unpack("<f", buf[payload:payload_end])[0])
        elif number == 7:
            int_vals.extend([value] if payload is None else _packed_varints(buf, payload, payload_end))
    if content:
        kind = {1: "<f4", 3: "<i4"}.get(dtype)
        if kind is None:
            raise ValueError(f"unhandled tensor dtype {dtype}")
        values = np.frombuffer(buf[content[0]:content[1]], kind)
    elif int_vals:
        values = np.array(int_vals, dtype="<i4")
    else:
        values = np.array(float_vals, dtype="<f4")
    if shape and values.size == int(np.prod(shape)):
        values = values.reshape(shape)
    return dtype, shape, values


def read_graph(buf):
    """The GraphDef as a list of {name, op, inputs, attrs} dicts."""
    nodes = []
    for number, _value, start, end in _fields(buf, 0, len(buf)):
        if number != 1:  # GraphDef.node
            continue
        node = {"name": None, "op": None, "inputs": [], "attrs": {}}
        for f, _v, s, e in _fields(buf, start, end):
            if f == 1:
                node["name"] = buf[s:e].decode()
            elif f == 2:
                node["op"] = buf[s:e].decode()
            elif f == 3:
                node["inputs"].append(buf[s:e].decode())
            elif f == 5:  # map<string, AttrValue>
                key = attr = None
                for f2, _v2, s2, e2 in _fields(buf, s, e):
                    if f2 == 1:
                        key = buf[s2:e2].decode()
                    elif f2 == 2:
                        attr = _attr_value(buf, s2, e2)
                node["attrs"][key] = attr or {}
        nodes.append(node)
    return nodes


# ------------------------------------------------------------- graph trimming

def clean(name):
    """A graph input reference down to the node it names."""
    return name.lstrip("^").split(":")[0]


def reachable(nodes, target):
    """Every node `target` depends on, in the graph's own order.

    The frozen graph lists all 142 Const nodes before any op, so slicing by
    position would keep the classifier weights; only the dependency tree tells
    the trunk apart from the heads.
    """
    by_name = {node["name"]: node for node in nodes}
    if target not in by_name:
        raise SystemExit(f"no node named {target} in the graph")
    seen, stack = set(), [target]
    while stack:
        name = clean(stack.pop())
        if name in seen or name not in by_name:
            continue
        seen.add(name)
        stack.extend(by_name[name]["inputs"])
    return [node for node in nodes if node["name"] in seen]


def describe(node, consts, buf):
    """One op as the JSON the browser executes, or None for a Const."""
    op, attrs = node["op"], node["attrs"]
    inputs = [clean(name) for name in node["inputs"]]
    if op == "Const":
        return None
    if op == "Placeholder":
        return {"op": "input", "name": node["name"]}
    if op == "Conv2D":
        strides = attrs["strides"]["list_i"]  # NHWC: [1, sy, sx, 1]
        return {
            "op": "conv2d", "name": node["name"], "input": inputs[0], "filter": inputs[1],
            "strides": [strides[1], strides[2]],
            "pad": attrs["padding"]["s"].lower(),
        }
    if op == "BiasAdd":
        return {"op": "biasAdd", "name": node["name"], "input": inputs[0], "bias": inputs[1]}
    if op == "Relu":
        return {"op": "relu", "name": node["name"], "input": inputs[0]}
    if op in ("MaxPool", "AvgPool"):
        ksize, strides = attrs["ksize"]["list_i"], attrs["strides"]["list_i"]
        return {
            "op": "maxPool" if op == "MaxPool" else "avgPool", "name": node["name"],
            "input": inputs[0], "ksize": [ksize[1], ksize[2]],
            "strides": [strides[1], strides[2]], "pad": attrs["padding"]["s"].lower(),
        }
    if op == "LRN":
        return {
            "op": "lrn", "name": node["name"], "input": inputs[0],
            "depthRadius": attrs["depth_radius"]["i"],
            "bias": attrs["bias"]["f"], "alpha": attrs["alpha"]["f"], "beta": attrs["beta"]["f"],
        }
    if op == "Concat":
        # TF1 Concat carries the axis in input 0, not as an attribute.
        axis = int(np.ravel(_tensor(buf, *consts[inputs[0]]["attrs"]["value"]["tensor"])[2])[0])
        return {"op": "concat", "name": node["name"], "inputs": inputs[1:], "axis": axis}
    raise ValueError(f"unhandled op {op} at {node['name']}")


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archive = fetch()
    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        buf = zf.read("tensorflow_inception_graph.pb")
        (OUTPUT / "LICENSE").write_bytes(zf.read("LICENSE"))

    nodes = reachable(read_graph(buf), CUT)
    consts = {node["name"]: node for node in nodes if node["op"] == "Const"}

    ops, weights, blob, offset = [], {}, [], 0
    channels = {}
    for node in nodes:
        described = describe(node, consts, buf)
        if described is None:
            continue
        # only conv filters and bias vectors are weights; LRN's own "bias" is a
        # scalar hyper-parameter that happens to share the name
        for key in {"conv2d": ("filter",), "biasAdd": ("bias",)}.get(described["op"], ()):
            name = described[key]
            if name in weights:
                continue
            _dtype, shape, values = _tensor(buf, *consts[name]["attrs"]["value"]["tensor"])
            half = values.astype("<f2")
            weights[name] = {"offset": offset, "shape": list(shape)}
            blob.append(half.tobytes())
            offset += half.nbytes
        ops.append(described)
        channels[described["name"]] = out_channels(described, weights, channels)

    (OUTPUT / "weights.bin").write_bytes(b"".join(blob))
    graph = {
        "source": SOURCE_URL,
        "sha256": hashlib.sha256(archive).hexdigest(),
        "licence": "Apache-2.0, Copyright 2015 The TensorFlow Authors",
        "note": "Convolutional trunk of inception5h, cut after " + CUT,
        "imagenetMean": IMAGENET_MEAN,
        "dtype": "float16",
        "weights": weights,
        "ops": ops,
        "channels": channels,
    }
    (OUTPUT / "graph.json").write_text(json.dumps(graph, indent=1, sort_keys=False) + "\n")

    print(f"{len(ops)} ops, {len(weights)} weight tensors")
    print(f"weights.bin  {offset / 1e6:.2f} MB (fp16)")
    print(f"graph.json   {(OUTPUT / 'graph.json').stat().st_size / 1e3:.1f} kB")
    print(f"source sha256 {graph['sha256']}")


def out_channels(described, weights, channels):
    """Channel count of an op's output, for the dialog's channel picker."""
    op = described["op"]
    if op == "conv2d":
        return weights[described["filter"]]["shape"][3]
    if op == "concat":
        return sum(channels[name] for name in described["inputs"])
    if op == "input":
        return 3
    return channels[described["input"]]


def fetch():
    # cached outside the repository: it is a 50 MB download that must never be
    # committed, and a rerun should not have to fetch it again
    cache = Path(tempfile.gettempdir()) / "inception5h.zip"
    if cache.exists():
        archive = cache.read_bytes()
    else:
        print(f"fetching {SOURCE_URL} …")
        with urllib.request.urlopen(SOURCE_URL) as response:
            archive = response.read()
        cache.write_bytes(archive)
    digest = hashlib.sha256(archive).hexdigest()
    if SOURCE_SHA256 and digest != SOURCE_SHA256:
        raise SystemExit(f"unexpected archive checksum {digest}")
    return archive


if __name__ == "__main__":
    main()
