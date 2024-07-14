export const getBase64Image = (id: string): string => {
  const selector = `#${id} canvas`;
  const srcCanvas = <any>document.querySelector(selector);

  const destinationCanvas = document.createElement("canvas");
  destinationCanvas.width = srcCanvas.width;
  destinationCanvas.height = srcCanvas.height;

  const destCtx = destinationCanvas.getContext("2d")!;

  //create a rectangle with the desired color
  destCtx.fillStyle = "#FFFFFF";
  destCtx.fillRect(0, 0, srcCanvas.width, srcCanvas.height);

  //draw the original canvas onto the destination canvas
  destCtx.drawImage(srcCanvas, 0, 0);

  let imgBase64 = destinationCanvas.toDataURL("image/png");
  return imgBase64;
};
