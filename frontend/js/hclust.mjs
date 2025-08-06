const { min, max, abs, pow, acos, PI } = Math;

const linkageDistance = {
  single: d => min(...d),
  complete: d => max(...d),
  average: d => sum(d) / d.length
};

export function hclust (arrays, distanceType = 'euclidean', linkageType = 'average', na = 'pairwise', arrayMin, arrayMax) {
  // Get initial distance matrix
  let distanceMatrix = dist(arrays, distanceType, na, arrayMin, arrayMax)
 
  // Calculate clusters
  let clusters = []
  let elements = [...Array(arrays.length).keys()].map(el => [el])
  while (elements.length !== 1) {
    let distances = []
    let i = 0
    while (i < elements.length) {
      let x, y
      let j = i + 1
      while (j < elements.length) {
        x = flattenDeep(elements[i])
        y = flattenDeep(elements[j])
        let cluster = [elements[i], elements[j]]
        let distance = distanceMatrix.filter(el => intersection(el.elements, x).length > 0 && intersection(el.elements, y).length > 0)
        distance = distance.map(el => el.distance)
        distance = linkageDistance[linkageType](distance)
        distances.push({ elements: cluster, distance, indices: [i, j] })
        j += 1
      }
      i += 1
    }
    let rawDistances = distances.map(el => el.distance)
    let minValue = min(...rawDistances)
    let cluster = distances[rawDistances.indexOf(minValue)]
    elements = elements.filter((value, index) => !cluster.indices.includes(index))
    delete cluster.indices
    clusters.unshift(cluster)
    elements.push(cluster.elements)
  }
  return clusters
}

/*DISTANCE*/
function euclidean (x, y) {
  let elementsDistance = x.map((value, index) => pow(x[index] - y[index], 2))
  return pow(sum(elementsDistance), 0.5)
}

function maximum (x, y) {
  let elementsDistance = x.map((value, index) => abs(x[index] - y[index]))
  return max(...elementsDistance)
}

function canberra (x, y) {
  let elementsDistance = x.map((value, index) => abs(x[index] - y[index]) / (abs(x[index]) + abs(y[index])))
  return sum(elementsDistance)
}

function manhattan (x, y) {
  let elementsDistance = x.map((value, index) => abs(x[index] - y[index]))
  return sum(elementsDistance)
}

function percent (x, y, maxDifference) {
  let elementsDistance = x.map((value, index) => abs(x[index] - y[index]))
  return (maxDifference - sum(elementsDistance)) * 100 / maxDifference
}

function cosine (x, y) {
  return dotProduct(x, y) / (pow(dotProduct(x, x), 0.5) * pow(dotProduct(y, y), 0.5))
}

function angular (x, y) {
  return 2 * acos(cosine(x, y)) / PI
}

function pearsonDistance (x, y) {
  return 1 - pearson(x, y)
}

function spearmanDistance (x, y) {
  return 1 - spearman(x, y)
}

const calculateDistance = {
  euclidean,
  maximum,
  canberra,
  manhattan,
  percent,
  cosine,
  angular,
  pearson: pearsonDistance,
  spearman: spearmanDistance
};


/*HELPER*/
function sum (x) {
  return x.reduce((a, b) => a + b)
}

function product (x, y) {
  return x.map((value, index) => (x[index] * y[index]))
}

function dotProduct (x, y) {
  return sum(product(x, y))
}

function mean (x) {
  return sum(x) / x.length
}

function residuals (x) {
  let average = mean(x)
  return x.map(el => el - average)
}

function variation (x) {
  let average = mean(x)
  let squaredResiduals = x.map(el => Math.pow(el - average, 2))
  return sum(squaredResiduals) / (x.length)
}

function sd (x) {
  return Math.pow(variation(x), 0.5)
}

function flattenDeep (arr1) {
  return arr1.reduce((acc, val) => Array.isArray(val) ? acc.concat(flattenDeep(val)) : acc.concat(val), [])
}

function intersection (array1, array2) {
  return array1.filter(value => array2.indexOf(value) !== -1)
}

function arrayToRanks (x) {
  let sortedArray = [...x].sort((a, b) => a - b)
  // Initial ranks
  let ranksArray = x.map(el => sortedArray.indexOf(el) + 1)
  // Fix tied ranks
  let tied = {}
  for (let r of [...new Set(ranksArray)]) {
    let len = ranksArray.filter(el => el === r).length
    tied[r] = len === 1 ? r : sum([...Array(len).keys()].map(el => el + r)) / len
  }
  ranksArray = ranksArray.map(el => tied[el])
  return ranksArray
}

function pearson (x, y) {
  return dotProduct(residuals(x), residuals(y)) / (sd(x) * sd(y) * x.length)
}

function spearman (x, y) {
  let rankedX = arrayToRanks(x)
  let rankedY = arrayToRanks(y)
  let squaredRankDifferece = rankedX.map((value, index) => Math.pow(rankedX[index] - rankedY[index], 2))
  return 1 - 6 * (sum(squaredRankDifferece) / (Math.pow(x.length, 3) - x.length))
}

/*MATRIX DISTANCE*/
function dist (arrays, distanceType = 'euclidean', na, arrayMin, arrayMax) {
  // Calculate inital distance matrix
  let distanceMatrix = []
  let i = 0
  let maxDifference
  if (arrayMin && arrayMax) maxDifference = (arrayMax - arrayMin) * arrays.length
  if (!maxDifference && distanceType === 'percent') {
    let allValues = flattenDeep(arrays)
    maxDifference = (max(...allValues) - min(...allValues)) * arrays.length
  }

  while (i < arrays.length) {
    let j = i + 1
    while (j < arrays.length) {
      let elements = [i, j]
      let x = arrays[i]
      let y = arrays[j]
      // Remove null values
      if (na === 'pairwise' && x.length && y.length) {
        let naFilter = x.map((value, index) => x[index] === null && y[index] === null)
        x = x.filter((value, index) => !naFilter[index])
        y = y.filter((value, index) => !naFilter[index])
      }
      if (!x.length || !y.length) return false
      let distance = calculateDistance[distanceType](x, y, maxDifference)
      distanceMatrix.push({ elements, distance })
      j += 1
    }
    i += 1
  }
  return distanceMatrix
}