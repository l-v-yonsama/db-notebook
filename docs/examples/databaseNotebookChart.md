# Database Notebook chart examples

This page shows an example of graph usage using the VS Code Extension "Database Notebook".

## TOC

## 1. Pie / Doughnut chart.

### Define cells.

```sql
SELECT TOP 5
country_code, (SUM(population) /1000) as population
FROM city
GROUP BY country_code
ORDER BY population DESC
```

#### Define cell metadata > chart.

| Title                   | Value            | Note                                          |
| :---------------------- | :--------------- | :-------------------------------------------- |
| Type                    | Pie or Doughnut  | -                                             |
| Title                   | TOP 5 population | Chart and tab title                           |
| Displays title on chart | ON               | Displays title on chart                       |
| Data values             | ON               | Displays values on data                       |
| \*Labels                | country_code     | Specify the column you want to use for labels |
| \*Data                  | population       | Specify the column you want to use for values |

### Execution Result.

`[Query Result]` 5 rows in set (0.01 sec)
| country_code | population |
| :--- | ---: |
| CHAR | INTEGER |
| ARG | 16441 |
| DZA | 5192 |
| NLD | 5180 |
| AGO | 2561 |
| AFG | 2332 |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/01_do.gif)

## 2. Bar chart.

### 2.1. Single dataset.

### Define cells.

```sql
SELECT country_code, SUM(population) as population
FROM city
GROUP BY country_code
ORDER BY population DESC
```

#### Define cell metadata > chart.

| Title                   | Value        | Note                                          |
| :---------------------- | :----------- | :-------------------------------------------- |
| Type                    | Bar Chart    | -                                             |
| Title                   | Population   | Chart and tab title                           |
| Displays title on chart | OFF          | Displays title on chart                       |
| Data values             | ON           | Displays values on data                       |
| Dataset multiple        | OFF          | Multiple dataset or not                       |
| \*Label(X)              | country_code | Specify the column you want to use for labels |
| \*Data(Y)               | population   | Specify the column you want to use for values |

### Execution Result.

`[Query Result]` 12 rows in set (0.01 sec)
| country_code | population |
| :--- | ---: |
| CHAR | INTEGER |
| ARG | 16441940 |
| DZA | 5192179 |
| NLD | 5180049 |
| AGO | 2561600 |
| AFG | 2332100 |
| ... | ... |
| ATG | 24000 |
| AND | 21189 |
| ASM | 7523 |
| ANT | 2345 |
| AIA | 1556 |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/021_singe_bar.png)

### 2.2. Multiple dataset.

### Define cells.

```sql
SELECT
    variety,
    max(sepal_length) as sepal_length,
    max(sepal_width) as sepal_width,
    max(petal_length) as petallength,
    max(petal_width) as petal_width
FROM
    iris
group by
    variety
```

#### Define cell metadata > chart.

| Title                   | Value        | Note                                           |
| :---------------------- | :----------- | :--------------------------------------------- |
| Type                    | Bar Chart    | -                                              |
| Title                   | Iris         | Chart and tab title                            |
| Displays title on chart | OFF          | Displays title on chart                        |
| Data values             | ON           | Displays values on data                        |
| Dataset multiple        | ON           | Multiple dataset or not                        |
| \*Label(X)              | variety      | Specify the column you want to use for labels  |
| \*Data(Y)               | sepal_length | Specify the column you want to use for values1 |
| \*Data(Y2)              | sepal_width  | Specify the column you want to use for values2 |
| \*Data(Y3)              | petallength  | Specify the column you want to use for values3 |
| \*Data(Y4)              | petal_width  | Specify the column you want to use for values4 |
| Stacked                 | OFF          | Stacked vertically or horizontally             |

### Execution Result.

`[Query Result]` 3 rows in set (0.01 sec)
| variety | sepal_length | sepal_width | petallength | petal_width |
| :--- | ---: | ---: | ---: | ---: |
| VARCHAR | NUMERIC | NUMERIC | NUMERIC | NUMERIC |
| Setosa | 5.8 | 4.4 | 1.9 | 0.6 |
| Versicolor | 7 | 3.4 | 5.1 | 1.8 |
| Virginica | 7.9 | 3.8 | 6.9 | 2.5 |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/022_multiple_bar.png)

## 3. Radar chart.

### 3.1. Single dataset.

### Define cells.

```sql
SELECT
    variety,
    max(sepal_length) as sepal_length,
    max(sepal_width) as sepal_width,
    max(petal_length) as petallength,
    max(petal_width) as petal_width
FROM
    iris
group by
    variety
```

#### Define cell metadata > chart.

| Title                   | Value                     | Note                                           |
| :---------------------- | :------------------------ | :--------------------------------------------- |
| Type                    | Radar Chart               | -                                              |
| Title                   | PopulatiIris attributeson | Chart and tab title                            |
| Displays title on chart | OFF                       | Displays title on chart                        |
| \*Data                  | sepal_length              | Specify the column you want to use for values1 |
| \*Data2                 | sepal_width               | Specify the column you want to use for values2 |
| \*Data3                 | petallength               | Specify the column you want to use for values3 |
| \*Data4                 | petal_width               | Specify the column you want to use for values4 |
| \*Group(Hue)            | --                        | Categorized item                               |

### Execution Result.

`[Query Result]` 3 rows in set (0.01 sec)
| variety | sepal_length | sepal_width | petallength | petal_width |
| :--- | ---: | ---: | ---: | ---: |
| VARCHAR | NUMERIC | NUMERIC | NUMERIC | NUMERIC |
| Setosa | 5.8 | 4.4 | 1.9 | 0.6 |
| Versicolor | 7 | 3.4 | 5.1 | 1.8 |
| Virginica | 7.9 | 3.8 | 6.9 | 2.5 |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/031_singe_radar.png)

### 3.2. Multiple dataset.

### Define cells.

```sql
SELECT
    variety,
    max(sepal_length) as sepal_length,
    max(sepal_width) as sepal_width,
    max(petal_length) as petallength,
    max(petal_width) as petal_width
FROM
    iris
group by
    variety
```

#### Define cell metadata > chart.

| Title                   | Value                     | Note                                           |
| :---------------------- | :------------------------ | :--------------------------------------------- |
| Type                    | Radar Chart               | -                                              |
| Title                   | PopulatiIris attributeson | Chart and tab title                            |
| Displays title on chart | OFF                       | Displays title on chart                        |
| \*Data                  | sepal_length              | Specify the column you want to use for values1 |
| \*Data2                 | sepal_width               | Specify the column you want to use for values2 |
| \*Data3                 | petallength               | Specify the column you want to use for values3 |
| \*Data4                 | petal_width               | Specify the column you want to use for values4 |
| \*Group(Hue)            | variety                   | Categorized item                               |

### Execution Result.

`[Query Result]` 3 rows in set (0.01 sec)
| variety | sepal_length | sepal_width | petallength | petal_width |
| :--- | ---: | ---: | ---: | ---: |
| VARCHAR | NUMERIC | NUMERIC | NUMERIC | NUMERIC |
| Setosa | 5.8 | 4.4 | 1.9 | 0.6 |
| Versicolor | 7 | 3.4 | 5.1 | 1.8 |
| Virginica | 7.9 | 3.8 | 6.9 | 2.5 |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/032_multiple_radar.png)

## 4. Scatter chart.

### 4.1. Single dataset.

### Define cells.

```sql
SELECT
    sepal_length,
    sepal_width,
    variety
FROM
    iris
```

#### Define cell metadata > chart.

| Title                   | Value         | Note                                           |
| :---------------------- | :------------ | :--------------------------------------------- |
| Type                    | Scatter Chart | -                                              |
| Title                   | iris          | Chart and tab title                            |
| Displays title on chart | ON            | Displays title on chart                        |
| Data values             | ON            | Displays values on data                        |
| \*DataX                 | sepal_length  | Specify the column you want to use for valuesX |
| \*DataY                 | sepal_width   | Specify the column you want to use for valuesY |
| \*Group(Hue)            | --            | Categorized item                               |

### Execution Result.

`[Query Result]` 150 rows in set (0.01 sec)
| sepal_length | sepal_width | variety |
| ---: | ---: | :--- |
| NUMERIC | NUMERIC | VARCHAR |
| 5.1 | 3.5 | Setosa |
| 4.9 | 3 | Setosa |
| 4.7 | 3.2 | Setosa |
| 4.6 | 3.1 | Setosa |
| 5 | 3.6 | Setosa |
| ... | ... | ... |
| 6.7 | 3 | Virginica |
| 6.3 | 2.5 | Virginica |
| 6.5 | 3 | Virginica |
| 6.2 | 3.4 | Virginica |
| 5.9 | 3 | Virginica |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/041_singe_scatter.png)

### 4.2. Multiple dataset.

### Define cells.

```sql
SELECT
    sepal_length,
    sepal_width,
    variety
FROM
    iris
```

#### Define cell metadata > chart.

| Title                   | Value         | Note                                           |
| :---------------------- | :------------ | :--------------------------------------------- |
| Type                    | Scatter Chart | -                                              |
| Title                   | iris          | Chart and tab title                            |
| Displays title on chart | ON            | Displays title on chart                        |
| Data values             | OFF           | Displays values on data                        |
| \*DataX                 | sepal_length  | Specify the column you want to use for valuesX |
| \*DataY                 | sepal_width   | Specify the column you want to use for valuesY |
| \*Group(Hue)            | variety       | Categorized item                               |

### Execution Result.

`[Query Result]` 150 rows in set (0.01 sec)
| sepal_length | sepal_width | variety |
| ---: | ---: | :--- |
| NUMERIC | NUMERIC | VARCHAR |
| 5.1 | 3.5 | Setosa |
| 4.9 | 3 | Setosa |
| 4.7 | 3.2 | Setosa |
| 4.6 | 3.1 | Setosa |
| 5 | 3.6 | Setosa |
| ... | ... | ... |
| 6.7 | 3 | Virginica |
| 6.3 | 2.5 | Virginica |
| 6.5 | 3 | Virginica |
| 6.2 | 3.4 | Virginica |
| 5.9 | 3 | Virginica |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/042_multiple_scatter.png)

## 5. Line chart.

### 5.1. Single dataset.

### Define cells.

```sql
select
    create_date,
    temperature
from
    weather
```

#### Define cell metadata > chart.

| Title                   | Value       | Note                                            |
| :---------------------- | :---------- | :---------------------------------------------- |
| Type                    | Line Chart  | -                                               |
| Title                   | weather     | Chart and tab title                             |
| Displays title on chart | ON          | Displays title on chart                         |
| Data values             | OFF         | Displays values on data                         |
| Dataset multiple        | OFF         | Multiple dataset or not                         |
| \*Labels(X)             | create_date | Specify the column you want to use for valuesX  |
| \*Data(Y):              | temperature | Specify the column you want to use for valuesY1 |
| \*Data(Y2):             | rainfall    | Specify the column you want to use for valuesY2 |
| \*Data(Y3):             | --          | Specify the column you want to use for valuesY3 |
| \*Data(Y4):             | --          | Specify the column you want to use for valuesY4 |

### Execution Result.

`[Query Result]` 7 rows in set (0.01 sec)
| create_date | temperature |
| :---: | ---: |
| DATE | NUMERIC |
| 2016-01-03 09:00:00 | 10.5 |
| 2016-01-04 09:00:00 | 11.2 |
| 2016-01-05 09:00:00 | 5.6 |
| 2016-01-06 09:00:00 | 8 |
| 2016-01-07 09:00:00 | 13.2 |
| 2016-01-08 09:00:00 | 9.5 |
| 2016-01-09 09:00:00 | 8.9 |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/051_singe_line.png)

### 5.2. Multiple dataset.

### Define cells.

```sql
select
    create_date,
    temperature,
    rainfall
from
    weather
```

#### Define cell metadata > chart.

| Title                   | Value       | Note                                            |
| :---------------------- | :---------- | :---------------------------------------------- |
| Type                    | Line Chart  | -                                               |
| Title                   | weather     | Chart and tab title                             |
| Displays title on chart | ON          | Displays title on chart                         |
| Data values             | OFF         | Displays values on data                         |
| Dataset multiple        | OFF         | Multiple dataset or not                         |
| \*Labels(X)             | create_date | Specify the column you want to use for valuesX  |
| \*Data(Y):              | temperature | Specify the column you want to use for valuesY1 |
| \*Data(Y2):             | rainfall    | Specify the column you want to use for valuesY2 |
| \*Data(Y3):             | --          | Specify the column you want to use for valuesY3 |
| \*Data(Y4):             | --          | Specify the column you want to use for valuesY4 |

### Execution Result.

`[Query Result]` 7 rows in set (0.01 sec)
| create_date | temperature | rainfall |
| :---: | ---: | ---: |
| DATE | NUMERIC | NUMERIC |
| 2016-01-03 09:00:00 | 10.5 | |
| 2016-01-04 09:00:00 | 11.2 | |
| 2016-01-05 09:00:00 | 5.6 | 3 |
| 2016-01-06 09:00:00 | 8 | 3 |
| 2016-01-07 09:00:00 | 13.2 | |
| 2016-01-08 09:00:00 | 9.5 | |
| 2016-01-09 09:00:00 | 8.9 | |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/052_multiple_line.png)

## 6. Pairplot chart.

### 6.1. Single dataset.

### Define cells.

```sql
SELECT * FROM iris
```

#### Define cell metadata > chart.

| Title                   | Value        | Note                    |
| :---------------------- | :----------- | :---------------------- |
| Type                    | Pair plot    | -                       |
| Title                   | irisPairPlot | Chart and tab title     |
| Displays title on chart | ON           | Displays title on chart |
| Data values             | OFF          | Displays values on data |
| Hue                     | --           | Categorized item        |

### Execution Result.

`[Query Result]` 150 rows in set (0.01 sec)
| sepal_length | sepal_width | petal_length | petal_width | variety |
| ---: | ---: | ---: | ---: | :--- |
| NUMERIC | NUMERIC | NUMERIC | NUMERIC | VARCHAR |
| 5.1 | 3.5 | 1.4 | 0.2 | Setosa |
| 4.9 | 3 | 1.4 | 0.2 | Setosa |
| 4.7 | 3.2 | 1.3 | 0.2 | Setosa |
| 4.6 | 3.1 | 1.5 | 0.2 | Setosa |
| 5 | 3.6 | 1.4 | 0.2 | Setosa |
| ... | ... | ... | ... | ... |
| 6.7 | 3 | 5.2 | 2.3 | Virginica |
| 6.3 | 2.5 | 5 | 1.9 | Virginica |
| 6.5 | 3 | 5.2 | 2 | Virginica |
| 6.2 | 3.4 | 5.4 | 2.3 | Virginica |
| 5.9 | 3 | 5.1 | 1.8 | Virginica |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/061_singe_pairplot.png)

### 6.2. Multiple dataset.

### Define cells.

```sql
SELECT * FROM iris
```

#### Define cell metadata > chart.

| Title                   | Value        | Note                    |
| :---------------------- | :----------- | :---------------------- |
| Type                    | Pair plot    | -                       |
| Title                   | irisPairPlot | Chart and tab title     |
| Displays title on chart | ON           | Displays title on chart |
| Data values             | OFF          | Displays values on data |
| Hue                     | variety      | Categorized item        |

### Execution Result.

`[Query Result]` 150 rows in set (0.01 sec)
| sepal_length | sepal_width | petal_length | petal_width | variety |
| ---: | ---: | ---: | ---: | :--- |
| NUMERIC | NUMERIC | NUMERIC | NUMERIC | VARCHAR |
| 5.1 | 3.5 | 1.4 | 0.2 | Setosa |
| 4.9 | 3 | 1.4 | 0.2 | Setosa |
| 4.7 | 3.2 | 1.3 | 0.2 | Setosa |
| 4.6 | 3.1 | 1.5 | 0.2 | Setosa |
| 5 | 3.6 | 1.4 | 0.2 | Setosa |
| ... | ... | ... | ... | ... |
| 6.7 | 3 | 5.2 | 2.3 | Virginica |
| 6.3 | 2.5 | 5 | 1.9 | Virginica |
| 6.5 | 3 | 5.2 | 2 | Virginica |
| 6.2 | 3.4 | 5.4 | 2.3 | Virginica |
| 5.9 | 3 | 5.1 | 1.8 | Virginica |

![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/charts/062_multiple_pairplot.png)
